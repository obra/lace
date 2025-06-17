// ABOUTME: Tests for ToolRegistry with MCP-style discovery capabilities
// ABOUTME: Validates metadata tracking and capability-based tool filtering

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../registry.js';
import { Tool, createSuccessResult } from '../types.js';

describe('ToolRegistry with MCP Capabilities', () => {
  let registry: ToolRegistry;

  const mockReadOnlyTool: Tool = {
    name: 'read_tool',
    description: 'A read-only tool',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      title: 'File Reader',
      readOnlyHint: true,
      idempotentHint: true,
    },
    executeTool: async () => createSuccessResult([]),
  };

  const mockDestructiveTool: Tool = {
    name: 'write_tool',
    description: 'A destructive tool',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      title: 'File Writer',
      destructiveHint: true,
      openWorldHint: true,
    },
    executeTool: async () => createSuccessResult([]),
  };

  const mockIdempotentTool: Tool = {
    name: 'cache_tool',
    description: 'An idempotent tool',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      title: 'Cache Manager',
      idempotentHint: true,
      readOnlyHint: false,
    },
    executeTool: async () => createSuccessResult([]),
  };

  const mockToolWithoutAnnotations: Tool = {
    name: 'simple_tool',
    description: 'A tool without annotations',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    executeTool: async () => createSuccessResult([]),
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.registerTool(mockReadOnlyTool);
    registry.registerTool(mockDestructiveTool);
    registry.registerTool(mockIdempotentTool);
    registry.registerTool(mockToolWithoutAnnotations);
  });

  describe('Basic registry functionality', () => {
    it('should register and retrieve tools', () => {
      expect(registry.getTool('read_tool')).toBe(mockReadOnlyTool);
      expect(registry.getTool('write_tool')).toBe(mockDestructiveTool);
      expect(registry.getAllTools()).toHaveLength(4);
    });

    it('should return tool names', () => {
      const names = registry.getToolNames();
      expect(names).toContain('read_tool');
      expect(names).toContain('write_tool');
      expect(names).toContain('cache_tool');
      expect(names).toContain('simple_tool');
    });
  });

  describe('Metadata tracking', () => {
    it('should track tool metadata with registration time', () => {
      const toolsWithMetadata = registry.getToolsWithMetadata();

      expect(toolsWithMetadata).toHaveLength(4);

      const readToolMeta = toolsWithMetadata.find((t) => t.tool.name === 'read_tool');
      expect(readToolMeta).toBeDefined();
      expect(readToolMeta!.metadata.registeredAt).toBeInstanceOf(Date);
      expect(readToolMeta!.metadata.usageCount).toBe(0);
    });

    it('should update usage tracking', () => {
      registry.trackToolUsage('read_tool');
      registry.trackToolUsage('read_tool');

      const toolsWithMetadata = registry.getToolsWithMetadata();
      const readToolMeta = toolsWithMetadata.find((t) => t.tool.name === 'read_tool');

      expect(readToolMeta!.metadata.usageCount).toBe(2);
      expect(readToolMeta!.metadata.lastUsed).toBeInstanceOf(Date);
    });

    it('should handle usage tracking for non-existent tools', () => {
      // Should not throw
      registry.trackToolUsage('nonexistent_tool');

      const toolsWithMetadata = registry.getToolsWithMetadata();
      expect(toolsWithMetadata).toHaveLength(4); // No new tools added
    });
  });

  describe('Capability-based discovery', () => {
    describe('getReadOnlyTools', () => {
      it('should return tools with readOnlyHint=true', () => {
        const readOnlyTools = registry.getReadOnlyTools();

        expect(readOnlyTools).toHaveLength(1);
        expect(readOnlyTools[0].name).toBe('read_tool');
        expect(readOnlyTools[0].annotations?.readOnlyHint).toBe(true);
      });

      it('should exclude tools with readOnlyHint=false', () => {
        const readOnlyTools = registry.getReadOnlyTools();

        const cacheToolIncluded = readOnlyTools.some((t) => t.name === 'cache_tool');
        expect(cacheToolIncluded).toBe(false);
      });

      it('should exclude tools without annotations', () => {
        const readOnlyTools = registry.getReadOnlyTools();

        const simpleToolIncluded = readOnlyTools.some((t) => t.name === 'simple_tool');
        expect(simpleToolIncluded).toBe(false);
      });
    });

    describe('getDestructiveTools', () => {
      it('should return tools with destructiveHint=true', () => {
        const destructiveTools = registry.getDestructiveTools();

        expect(destructiveTools).toHaveLength(1);
        expect(destructiveTools[0].name).toBe('write_tool');
        expect(destructiveTools[0].annotations?.destructiveHint).toBe(true);
      });

      it('should exclude non-destructive tools', () => {
        const destructiveTools = registry.getDestructiveTools();

        const readToolIncluded = destructiveTools.some((t) => t.name === 'read_tool');
        expect(readToolIncluded).toBe(false);
      });
    });

    describe('getIdempotentTools', () => {
      it('should return tools with idempotentHint=true', () => {
        const idempotentTools = registry.getIdempotentTools();

        expect(idempotentTools).toHaveLength(2);
        const toolNames = idempotentTools.map((t) => t.name);
        expect(toolNames).toContain('read_tool');
        expect(toolNames).toContain('cache_tool');
      });

      it('should exclude non-idempotent tools', () => {
        const idempotentTools = registry.getIdempotentTools();

        const writeToolIncluded = idempotentTools.some((t) => t.name === 'write_tool');
        expect(writeToolIncluded).toBe(false);
      });
    });

    describe('getOpenWorldTools', () => {
      it('should return tools with openWorldHint=true', () => {
        const openWorldTools = registry.getOpenWorldTools();

        expect(openWorldTools).toHaveLength(1);
        expect(openWorldTools[0].name).toBe('write_tool');
        expect(openWorldTools[0].annotations?.openWorldHint).toBe(true);
      });

      it('should exclude closed-world tools', () => {
        const openWorldTools = registry.getOpenWorldTools();

        const readToolIncluded = openWorldTools.some((t) => t.name === 'read_tool');
        expect(readToolIncluded).toBe(false);
      });
    });

    describe('getToolsByTitle', () => {
      it('should find tools by title', () => {
        const fileTools = registry.getToolsByTitle('File');

        expect(fileTools).toHaveLength(2);
        const toolNames = fileTools.map((t) => t.name);
        expect(toolNames).toContain('read_tool');
        expect(toolNames).toContain('write_tool');
      });

      it('should be case sensitive', () => {
        const tools = registry.getToolsByTitle('file');
        expect(tools).toHaveLength(0);
      });

      it('should return empty array for non-matching titles', () => {
        const tools = registry.getToolsByTitle('Database');
        expect(tools).toHaveLength(0);
      });

      it('should handle tools without titles', () => {
        const tools = registry.getToolsByTitle('Simple');
        expect(tools).toHaveLength(0);
      });
    });
  });

  describe('Complex filtering scenarios', () => {
    it('should handle tools with multiple behavioral hints', () => {
      const readOnlyIdempotent = registry
        .getAllTools()
        .filter(
          (tool) =>
            tool.annotations?.readOnlyHint === true && tool.annotations?.idempotentHint === true
        );

      expect(readOnlyIdempotent).toHaveLength(1);
      expect(readOnlyIdempotent[0].name).toBe('read_tool');
    });

    it('should handle tools with conflicting hints gracefully', () => {
      const conflictingTool: Tool = {
        name: 'conflicting_tool',
        description: 'A tool with conflicting hints',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: true, // This is logically inconsistent
        },
        executeTool: async () => createSuccessResult([]),
      };

      registry.registerTool(conflictingTool);

      const readOnlyTools = registry.getReadOnlyTools();
      const destructiveTools = registry.getDestructiveTools();

      expect(readOnlyTools.some((t) => t.name === 'conflicting_tool')).toBe(true);
      expect(destructiveTools.some((t) => t.name === 'conflicting_tool')).toBe(true);
    });
  });

  describe('Registry management', () => {
    it('should clear all tools and metadata', () => {
      registry.clear();

      expect(registry.getAllTools()).toHaveLength(0);
      expect(registry.getToolsWithMetadata()).toHaveLength(0);
      expect(registry.getReadOnlyTools()).toHaveLength(0);
    });

    it('should handle duplicate tool registration', () => {
      const duplicateTool: Tool = {
        name: 'read_tool', // Same name as existing tool
        description: 'Updated read tool',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          title: 'Updated Reader',
        },
        executeTool: async () => createSuccessResult([]),
      };

      registry.registerTool(duplicateTool);

      expect(registry.getAllTools()).toHaveLength(4); // Still 4 tools
      expect(registry.getTool('read_tool')?.description).toBe('Updated read tool');
    });
  });
});
