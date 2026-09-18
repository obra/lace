// ABOUTME: Tests that the LunaRoute-class Content-Type tolerance fetch wrapper is wired
// ABOUTME: into the OpenAI client only for custom endpoints opted into api_style:'responses'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider';

let capturedOptions: Record<string, unknown> | undefined;

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
    responses = { create: vi.fn() };
    constructor(options: Record<string, unknown>) {
      capturedOptions = options;
    }
  }
  return { default: MockOpenAI };
});

vi.mock('@lace/agent/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    shouldLog: vi.fn().mockReturnValue(false),
  },
}));

const CUSTOM_BASE_URL = 'https://gw.example.com/v1';

// getOpenAIClient() is private and lazily constructs the client on first use;
// reach past the access modifier (TS-only, not enforced at runtime).
function touchClient(provider: OpenAIProvider): void {
  (provider as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient();
}

describe('OpenAIProvider Content-Type tolerance fetch wiring', () => {
  beforeEach(() => {
    capturedOptions = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('wires a tolerant fetch for a custom endpoint opted into api_style: responses', () => {
    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: CUSTOM_BASE_URL,
      apiStyle: 'responses',
    });
    touchClient(provider);

    expect(typeof capturedOptions?.fetch).toBe('function');
  });

  it('does not wire a tolerant fetch for a custom endpoint on the default Chat Completions path', () => {
    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: CUSTOM_BASE_URL,
    });
    touchClient(provider);

    expect(capturedOptions?.fetch).toBeUndefined();
  });

  it('does not wire a tolerant fetch for the real OpenAI API even with apiStyle set', () => {
    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      apiStyle: 'responses',
    });
    touchClient(provider);

    expect(capturedOptions?.fetch).toBeUndefined();
  });
});
