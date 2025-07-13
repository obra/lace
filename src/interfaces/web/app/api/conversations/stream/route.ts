// ABOUTME: Streaming conversation API using Server-Sent Events with core Lace components
// ABOUTME: Provides real-time AI chat functionality integrated with Lace's backend

import { NextRequest } from 'next/server';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { DelegateTool } from '~/tools/implementations/delegate';
import { getLaceDbPath } from '~/config/lace-dir';
import { loadEnvFile, getEnvVar } from '~/config/env-loader';
import { logger } from '~/utils/logger';
import { AIProvider } from '~/providers/base-provider';

// Initialize environment
loadEnvFile();

interface StreamConversationRequest {
  message: string;
  threadId?: string;
  provider?: string;
  model?: string;
}

// Provider initialization
async function createProvider(
  providerType: string = 'anthropic',
  model?: string
): Promise<AIProvider> {
  const providerInitializers: Record<
    string,
    (config: { apiKey?: string; model?: string }) => Promise<AIProvider>
  > = {
    anthropic: async ({ apiKey, model }) => {
      if (getEnvVar('LACE_TEST_MODE') === 'true') {
        const { createMockProvider } = await import('~/__tests__/utils/mock-provider');
        return createMockProvider();
      }

      const { AnthropicProvider } = await import('~/providers/anthropic-provider');
      if (!apiKey) {
        throw new Error('Anthropic API key is required');
      }
      return new AnthropicProvider({ apiKey, model });
    },
    openai: async ({ apiKey, model }) => {
      const { OpenAIProvider } = await import('~/providers/openai-provider');
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
      throw new Error('ANTHROPIC_KEY environment variable required');
    }
  } else if (providerType === 'openai') {
    apiKey = getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY or OPENAI_KEY environment variable required');
    }
  }

  return initializer({ apiKey, model });
}

async function setupAgent(threadId: string, provider: string, model?: string): Promise<Agent> {
  const toolExecutor = new ToolExecutor();
  toolExecutor.registerAllAvailableTools();

  const dbPath = getLaceDbPath();
  const threadManager = new ThreadManager(dbPath);

  const aiProvider = await createProvider(provider, model);

  const agent = new Agent({
    provider: aiProvider,
    toolExecutor,
    threadManager,
    threadId,
    tools: toolExecutor.getAllTools(),
  });

  const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
  if (delegateTool) {
    delegateTool.setDependencies(agent, toolExecutor);
  }

  return agent;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StreamConversationRequest;

    if (!body.message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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
      const sessionInfo = threadManager.resumeOrCreate(body.threadId);
      threadId = sessionInfo.threadId;
      isNew = !sessionInfo.isResumed;
    } else {
      const sessionInfo = threadManager.resumeOrCreate();
      threadId = sessionInfo.threadId;
      isNew = true;
    }

    // Setup agent
    const agent = await setupAgent(threadId, provider, model);

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial connection event
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'connection',
                threadId,
                isNew,
                provider,
                model: model || 'default',
              })}\n\n`
            )
          );

          // Setup agent event listeners
          agent.on('agent_thinking_start', () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'thinking_start',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          });

          agent.on('agent_thinking_complete', () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'thinking_complete',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          });

          agent.on('agent_token', ({ token }: { token: string }) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'token',
                  content: token,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          });

          agent.on('tool_call_start', ({ toolName, input, callId }) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'tool_call_start',
                  toolCall: {
                    name: toolName,
                    id: callId,
                    parameters: input,
                  },
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          });

          agent.on('tool_call_complete', ({ toolName, result, callId }) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'tool_call_complete',
                  toolCall: {
                    name: toolName,
                    id: callId,
                  },
                  result: {
                    success: !result.isError,
                    content: result.content,
                    isError: result.isError,
                  },
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          });

          agent.on('agent_response_complete', () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'response_complete',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          });

          agent.on('conversation_complete', () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'conversation_complete',
                  threadId,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );

            // Clean up and close stream
            agent.stop();
            controller.close();
          });

          agent.on('error', ({ error }: { error: Error }) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: error.message,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );

            agent.stop();
            controller.close();
          });

          // Start conversation
          await agent.start();
          await agent.sendMessage(body.message);
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to process conversation',
                timestamp: new Date().toISOString(),
              })}\n\n`
            )
          );

          controller.close();
        }
      },

      cancel() {
        // Clean up if client disconnects
        try {
          agent.stop();
        } catch (error) {
          logger.error('Error stopping agent during stream cancel:', error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    logger.error('API streaming conversation error:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to process streaming conversation',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
