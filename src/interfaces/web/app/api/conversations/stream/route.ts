// ABOUTME: Streaming conversation API using Server-Sent Events with core Lace components
// ABOUTME: Provides real-time AI chat functionality using Agent event emitter pattern

import { NextRequest } from 'next/server';
import { sharedAgentService } from '~/interfaces/web/lib/agent-service';
import { logger } from '~/utils/logger';

interface StreamConversationRequest {
  message: string;
  threadId?: string;
  provider?: string;
  model?: string;
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

    // Create agent through centralized service
    const { agent, threadInfo } = await sharedAgentService.createAgentForThread(body.threadId);

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
                threadId: threadInfo.threadId,
                isNew: threadInfo.isNew,
                provider: body.provider || 'anthropic',
                model: body.model || 'default',
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
                  threadId: threadInfo.threadId,
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
