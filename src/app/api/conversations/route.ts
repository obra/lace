// ABOUTME: Proper API route for conversation management using core Lace components
import { NextRequest, NextResponse } from 'next/server';
import { Agent } from '~/agents/agent.js';
import { ToolExecutor } from '~/tools/executor.js';
import { ThreadManager } from '~/threads/thread-manager.js';
import { DelegateTool } from '~/tools/implementations/delegate.js';
import { getLaceDbPath } from '~/config/lace-dir.js';
import { loadEnvFile, getEnvVar } from '~/config/env-loader.js';
import { logger } from '~/utils/logger.js';
import { AIProvider } from '~/providers/base-provider.js';

// Initialize environment
loadEnvFile();

interface CreateConversationRequest {
  message: string;
  threadId?: string;
  provider?: string;
  model?: string;
}

interface ConversationResponse {
  threadId: string;
  content: string;
  toolCalls?: unknown[];
  isNew: boolean;
}

// Provider initialization (extracted from app.ts)
async function createProvider(
  providerType: string = 'anthropic',
  model?: string
): Promise<AIProvider> {
  const providerInitializers: Record<
    string,
    (config: { apiKey?: string; model?: string }) => Promise<AIProvider>
  > = {
    anthropic: async ({ apiKey, model }) => {
      // Check for test mode
      if (getEnvVar('LACE_TEST_MODE') === 'true') {
        const { createMockProvider } = await import('~/__tests__/utils/mock-provider.js');
        return createMockProvider();
      }

      const { AnthropicProvider } = await import('~/providers/anthropic-provider.js');
      if (!apiKey) {
        throw new Error('Anthropic API key is required');
      }
      return new AnthropicProvider({ apiKey, model });
    },
    openai: async ({ apiKey, model }) => {
      const { OpenAIProvider } = await import('~/providers/openai-provider.js');
      if (!apiKey) {
        throw new Error('OpenAI API key is required');
      }
      return new OpenAIProvider({ apiKey, model });
    },
  };

  const initializer = providerInitializers[providerType];
  if (!initializer) {
    throw new Error(
      `Unknown provider: ${providerType}. Available: ${Object.keys(providerInitializers).join(', ')}`
    );
  }

  let apiKey: string | undefined;
  if (providerType === 'anthropic') {
    apiKey = getEnvVar('ANTHROPIC_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_KEY environment variable required for Anthropic provider');
    }
  } else if (providerType === 'openai') {
    apiKey = getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY or OPENAI_KEY environment variable required for OpenAI provider'
      );
    }
  }

  return initializer({ apiKey, model });
}

// Setup agent with proper component initialization
async function setupAgent(threadId: string, provider: string, model?: string): Promise<Agent> {
  // Initialize tool executor
  const toolExecutor = new ToolExecutor();
  toolExecutor.registerAllAvailableTools();

  // Initialize thread manager
  const dbPath = getLaceDbPath();
  const threadManager = new ThreadManager(dbPath);

  // Create provider
  const aiProvider = await createProvider(provider, model);

  // Create agent
  const agent = new Agent({
    provider: aiProvider,
    toolExecutor,
    threadManager,
    threadId,
    tools: toolExecutor.getAllTools(),
  });

  // Setup delegate tool dependencies
  const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
  if (delegateTool) {
    delegateTool.setDependencies(agent, toolExecutor);
  }

  return agent;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateConversationRequest;

    if (!body.message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Configure logger
    logger.configure('info');

    const provider = body.provider || 'anthropic';
    const model = body.model;

    // Setup thread management
    const dbPath = getLaceDbPath();
    const threadManager = new ThreadManager(dbPath);

    // Handle existing thread or create new one
    let threadId: string;
    let isNew = false;

    if (body.threadId) {
      // Resume existing conversation
      const sessionInfo = threadManager.resumeOrCreate(body.threadId);
      threadId = sessionInfo.threadId;
      isNew = !sessionInfo.isResumed;
    } else {
      // Create new conversation
      const sessionInfo = threadManager.resumeOrCreate();
      threadId = sessionInfo.threadId;
      isNew = true;
    }

    // Setup agent
    const agent = await setupAgent(threadId, provider, model);

    // Create promise to collect the response
    const conversationPromise = new Promise<ConversationResponse>((resolve, reject) => {
      let responseContent = '';
      const toolCalls: unknown[] = [];

      // Listen for agent events
      agent.on('agent_token', ({ token }: { token: string }) => {
        responseContent += token;
      });

      agent.on('tool_call_start', ({ toolName, input, callId }) => {
        toolCalls.push({ name: toolName, input, id: callId });
      });

      agent.on('conversation_complete', () => {
        resolve({
          threadId,
          content: responseContent.trim(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          isNew,
        });
      });

      agent.on('error', ({ error }: { error: Error }) => {
        reject(error);
      });
    });

    // Start agent and send message
    await agent.start();
    await agent.sendMessage(body.message);

    // Wait for conversation to complete
    const response = await conversationPromise;

    // Clean up
    agent.stop();

    return NextResponse.json(response);
  } catch (error) {
    logger.error('API conversation error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process conversation',
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve conversation history
export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId parameter is required' }, { status: 400 });
    }

    // Initialize thread manager
    const dbPath = getLaceDbPath();
    const threadManager = new ThreadManager(dbPath);

    // Get conversation events
    const events = threadManager.getEvents(threadId);

    if (!events || events.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Transform events into a more API-friendly format
    const messages = events
      .filter((event) => event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE')
      .map((event) => ({
        id: event.id,
        type: event.type.toLowerCase().replace('_', ''),
        content: typeof event.data === 'string' ? event.data : '',
        timestamp: event.timestamp.toISOString(),
        toolCalls:
          event.type === 'AGENT_MESSAGE' &&
          typeof event.data === 'object' &&
          event.data !== null &&
          'toolCalls' in event.data
            ? (event.data as { toolCalls?: unknown[] }).toolCalls
            : undefined,
      }));

    return NextResponse.json({
      threadId,
      messages,
      totalEvents: events.length,
    });
  } catch (error) {
    logger.error('API conversation history error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve conversation',
      },
      { status: 500 }
    );
  }
}
