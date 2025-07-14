// ABOUTME: Persistent streaming conversation API using Server-Sent Events with core Lace components
import { NextRequest } from 'next/server';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { DelegateTool } from '~/tools/implementations/delegate';
import { getLaceDbPath } from '~/config/lace-dir';
import { loadEnvFile, getEnvVar } from '~/config/env-loader';
import { logger } from '~/utils/logger';
import { AIProvider } from '~/providers/base-provider';
import { ToolResult } from '~/tools/types';

// Initialize environment
loadEnvFile();

interface StreamConversationRequest {
  message: string;
  threadId?: string;
  provider?: string;
  model?: string;
}

// Global persistent instances (reused across requests for same thread)
const threadManagers = new Map<string, ThreadManager>();
const agents = new Map<string, Agent>();
const toolExecutors = new Map<string, ToolExecutor>();

// Clean up inactive connections after 30 minutes
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
const connectionTimestamps = new Map<string, number>();

// Periodic cleanup of inactive connections
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of connectionTimestamps.entries()) {
    if (now - timestamp > CLEANUP_INTERVAL) {
      const agent = agents.get(key);
      if (agent) {
        agent.stop();
      }
      agents.delete(key);
      threadManagers.delete(key);
      toolExecutors.delete(key);
      connectionTimestamps.delete(key);
      logger.info(`Cleaned up inactive connection: ${key}`);
    }
  }
}, CLEANUP_INTERVAL);

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

async function getOrCreateAgent(
  connectionKey: string,
  threadId: string,
  provider: string,
  model?: string
): Promise<{ agent: Agent; threadManager: ThreadManager; isNew: boolean }> {
  // Check if we already have an agent for this connection
  let agent = agents.get(connectionKey);
  let threadManager = threadManagers.get(connectionKey);
  let toolExecutor = toolExecutors.get(connectionKey);

  if (agent && threadManager && toolExecutor) {
    // Update activity timestamp
    connectionTimestamps.set(connectionKey, Date.now());
    return { agent, threadManager, isNew: false };
  }

  // Create new persistent instances
  const dbPath = getLaceDbPath();
  threadManager = new ThreadManager(dbPath);
  threadManagers.set(connectionKey, threadManager);

  toolExecutor = new ToolExecutor();
  toolExecutor.registerAllAvailableTools();
  toolExecutors.set(connectionKey, toolExecutor);

  const aiProvider = await createProvider(provider, model);

  agent = new Agent({
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

  agents.set(connectionKey, agent);
  connectionTimestamps.set(connectionKey, Date.now());

  return { agent, threadManager, isNew: true };
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

    // Create connection key for this client/thread combination
    // const connectionKey = `${body.threadId || 'new'}-${provider}-${model || 'default'}`;

    // Handle existing thread or create new one
    let threadId: string;
    let isNewThread = false;

    // Get or create thread manager first to determine thread ID
    const dbPath = getLaceDbPath();
    const tempThreadManager = new ThreadManager(dbPath);

    if (body.threadId) {
      const sessionInfo = tempThreadManager.resumeOrCreate(body.threadId);
      threadId = sessionInfo.threadId;
      isNewThread = !sessionInfo.isResumed;
    } else {
      const sessionInfo = tempThreadManager.resumeOrCreate();
      threadId = sessionInfo.threadId;
      isNewThread = true;
    }

    // Update connection key with actual thread ID
    const actualConnectionKey = `${threadId}-${provider}-${model || 'default'}`;

    // Get or create persistent agent and thread manager
    const { agent, isNew: isNewAgent } = await getOrCreateAgent(
      actualConnectionKey,
      threadId,
      provider,
      model
    );

    // Initialize agent if it's new
    if (isNewAgent) {
      await agent.start();
    }

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
                isNewThread,
                isNewAgent,
                provider,
                model: model || 'default',
                connectionKey: actualConnectionKey,
              })}\n\n`
            )
          );

          // Setup one-time event listeners for this stream
          const thinking_start = () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'thinking_start',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          };

          const thinking_complete = () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'thinking_complete',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          };

          const agent_token = ({ token }: { token: string }) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'token',
                  content: token,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          };

          const tool_call_start = ({
            toolName,
            input,
            callId,
          }: {
            toolName: string;
            input: Record<string, unknown>;
            callId: string;
          }) => {
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
          };

          const tool_call_complete = ({
            toolName,
            result,
            callId,
          }: {
            toolName: string;
            result: ToolResult;
            callId: string;
          }) => {
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
                    content: result.content
                      .map((block) => block.text || block.data || block.uri || '')
                      .join('\n'),
                    isError: result.isError,
                  },
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );
          };

          const agent_response_complete = () => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'response_complete',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );

            // Clean up listeners and close stream - frontend will create new stream for next message
            cleanupListeners();
            controller.close();
          };

          const error = ({ error }: { error: Error }) => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: error.message,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              )
            );

            // Clean up this specific stream on error, but keep agent alive
            cleanupListeners();
            controller.close();
          };

          // Add event listeners
          const cleanupListeners = () => {
            agent.off('agent_thinking_start', thinking_start);
            agent.off('agent_thinking_complete', thinking_complete);
            agent.off('agent_token', agent_token);
            agent.off('tool_call_start', tool_call_start);
            agent.off('tool_call_complete', tool_call_complete);
            agent.off('agent_response_complete', agent_response_complete);
            agent.off('error', error);
          };

          agent.on('agent_thinking_start', thinking_start);
          agent.on('agent_thinking_complete', thinking_complete);
          agent.on('agent_token', agent_token);
          agent.on('tool_call_start', tool_call_start);
          agent.on('tool_call_complete', tool_call_complete);
          agent.on('agent_response_complete', agent_response_complete);
          agent.on('error', error);

          // Send the message
          await agent.sendMessage(body.message);

          // Keep the stream open for potential future messages
          // The client will need to explicitly close or send another message
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
        // Clean up if client disconnects, but keep agent alive for potential reconnection
        try {
          // Update timestamp to indicate recent activity even on disconnect
          connectionTimestamps.set(actualConnectionKey, Date.now());
          logger.info(`Client disconnected from connection: ${actualConnectionKey}`);
        } catch (error) {
          logger.error('Error handling stream cancel:', error);
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
