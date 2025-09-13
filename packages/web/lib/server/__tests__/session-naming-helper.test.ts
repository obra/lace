// ABOUTME: Tests for session naming helper using InfrastructureHelper
// ABOUTME: Validates session name generation with proper constraints and helper integration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSessionName } from '../session-naming-helper';
import { InfrastructureHelper } from '../lace-imports';

// Mock the lace-imports module
vi.mock('../lace-imports', () => ({
  InfrastructureHelper: vi.fn(),
}));

const MockedInfrastructureHelper = vi.mocked(InfrastructureHelper);

describe('generateSessionName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create InfrastructureHelper with correct configuration', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      content: 'Fix Auth Bug',
    });

    MockedInfrastructureHelper.mockImplementation(
      () =>
        ({
          execute: mockExecute,
        }) as any
    );

    await generateSessionName('MyProject', 'I need to fix the authentication redirect bug');

    expect(MockedInfrastructureHelper).toHaveBeenCalledWith({
      model: 'fast',
      tools: [],
    });
  });

  it('should format prompt correctly with project name and user input', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      content: 'Fix Auth Bug',
    });

    MockedInfrastructureHelper.mockImplementation(
      () =>
        ({
          execute: mockExecute,
        }) as any
    );

    await generateSessionName('MyProject', 'I need to fix the authentication redirect bug');

    expect(mockExecute).toHaveBeenCalledWith(
      `Here's the project name: 'MyProject'. Here's what the user wrote: 'I need to fix the authentication redirect bug'. Return a brief descriptive name for this session. No more than 5 words.`
    );
  });

  it('should return trimmed session name from helper result', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      content: '  Fix Auth Bug  ',
    });

    MockedInfrastructureHelper.mockImplementation(
      () =>
        ({
          execute: mockExecute,
        }) as any
    );

    const result = await generateSessionName(
      'MyProject',
      'I need to fix the authentication redirect bug'
    );

    expect(result).toBe('Fix Auth Bug');
  });

  it('should handle different project names and user inputs', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      content: 'Add Dark Mode',
    });

    MockedInfrastructureHelper.mockImplementation(
      () =>
        ({
          execute: mockExecute,
        }) as any
    );

    await generateSessionName('Frontend App', 'Add dark mode toggle to settings');

    expect(mockExecute).toHaveBeenCalledWith(
      `Here's the project name: 'Frontend App'. Here's what the user wrote: 'Add dark mode toggle to settings'. Return a brief descriptive name for this session. No more than 5 words.`
    );
  });

  it('should use fallback model when provided', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      content: 'Fix Auth Bug',
    });

    const mockProvider = {} as any; // Mock AIProvider

    MockedInfrastructureHelper.mockImplementation(
      () =>
        ({
          execute: mockExecute,
        }) as any
    );

    await generateSessionName('MyProject', 'Fix auth bug', {
      provider: mockProvider,
      modelId: 'test-model',
    });

    expect(MockedInfrastructureHelper).toHaveBeenCalledWith({
      model: 'fast',
      tools: [],
      fallbackProvider: mockProvider,
      fallbackModelId: 'test-model',
    });
  });
});
