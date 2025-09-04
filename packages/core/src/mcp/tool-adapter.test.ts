import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolAdapter } from './tool-adapter';
import type { MCPTool } from './types';
import type { Client } from '../../../vendor/typescript-sdk/src/client/index.js';

describe('MCPToolAdapter', () => {
  const mockMCPTool: MCPTool = {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        encoding: { type: 'string', description: 'File encoding' },
      },
      required: ['path'],
    },
  };

  const mockClient = {
    callTool: vi.fn(),
  } as unknown as Client;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create tool with correct name and description', () => {
    const adapter = new MCPToolAdapter(mockMCPTool, 'filesystem', mockClient);

    expect(adapter.name).toBe('filesystem/read_file');
    expect(adapter.description).toBe('Read a file from the filesystem');
  });

  it('should generate Zod schema from JSON Schema', () => {
    const adapter = new MCPToolAdapter(mockMCPTool, 'filesystem', mockClient);

    // Test schema validation
    const validArgs = { path: '/test.txt', encoding: 'utf-8' };
    const invalidArgs = { encoding: 'utf-8' }; // Missing required path

    expect(() => adapter.schema.parse(validArgs)).not.toThrow();
    expect(() => adapter.schema.parse(invalidArgs)).toThrow();
  });

  it('should execute MCP tool and return success result', async () => {
    const mockCallTool = mockClient.callTool as vi.MockedFunction<typeof mockClient.callTool>;

    mockCallTool.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'File contents here',
        },
      ],
      isError: false,
    });

    const adapter = new MCPToolAdapter(mockMCPTool, 'filesystem', mockClient);
    const result = await adapter.execute({ path: '/test.txt' }, {} as any);

    expect(result.status).toBe('completed');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'File contents here',
      },
    ]);

    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'read_file',
      arguments: { path: '/test.txt' },
    });
  });

  it('should handle MCP tool errors', async () => {
    const mockCallTool = mockClient.callTool as vi.MockedFunction<typeof mockClient.callTool>;

    mockCallTool.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'File not found',
        },
      ],
      isError: true,
    });

    const adapter = new MCPToolAdapter(mockMCPTool, 'filesystem', mockClient);
    const result = await adapter.execute({ path: '/nonexistent.txt' }, {} as any);

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('File not found');
  });

  it('should handle connection/network errors', async () => {
    const mockCallTool = mockClient.callTool as vi.MockedFunction<typeof mockClient.callTool>;

    mockCallTool.mockRejectedValue(new Error('Connection refused'));

    const adapter = new MCPToolAdapter(mockMCPTool, 'filesystem', mockClient);
    const result = await adapter.execute({ path: '/test.txt' }, {} as any);

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Failed to execute MCP tool');
    expect(result.content[0].text).toContain('Connection refused');
  });

  it('should handle different MCP content types', async () => {
    const mockCallTool = mockClient.callTool as vi.MockedFunction<typeof mockClient.callTool>;

    mockCallTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'image', data: 'base64data' },
        { type: 'resource', resource: { uri: 'file://test.txt' } },
      ],
      isError: false,
    });

    const adapter = new MCPToolAdapter(mockMCPTool, 'filesystem', mockClient);
    const result = await adapter.execute({ path: '/test.txt' }, {} as any);

    expect(result.status).toBe('completed');
    expect(result.content).toHaveLength(3);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(result.content[1]).toEqual({ type: 'image', data: 'base64data' });
    expect(result.content[2]).toEqual({
      type: 'resource',
      uri: 'file://test.txt',
    });
  });
});
