// ABOUTME: Streaming conversation API using Server-Sent Events with core Lace components
// ABOUTME: Provides real-time AI chat functionality using Agent event emitter pattern

import { NextRequest } from 'next/server';
import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';
import { logger } from '~/utils/logger';

interface StreamConversationRequest {
  message: string;
  threadId?: string;
  provider?: string;
  model?: string;
}

interface ThreadInfo {
  threadId: string;
  isNew: boolean;
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  
  logger.info('Stream API request received', { requestId, url: request.url });
  
  let body: StreamConversationRequest | undefined;
  
  try {
    body = (await request.json()) as StreamConversationRequest;
    logger.info('Stream API request body', { requestId, body });

    if (!body?.message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create agent through direct context access
    const agent = getAgentFromRequest(request);
    
    // Get thread state
    const currentThreadId = agent.getCurrentThreadId();
    const latestThreadId = agent.getLatestThreadId();
    
    logger.info('Stream API thread debug:', {
      requestId,
      requestedThreadId: body.threadId,
      currentThreadId,
      latestThreadId,
    });
    
    // If no threadId provided, use current active thread instead of creating new one
    const targetThreadId = body.threadId || currentThreadId || undefined;
    
    const sessionInfo = agent.resumeOrCreateThread(targetThreadId);
    
    logger.info('Session info:', { requestId, sessionInfo });

    const threadInfo: ThreadInfo = {
      threadId: sessionInfo.threadId,
      isNew: !sessionInfo.isResumed,
    };

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
                provider: body?.provider || 'anthropic',
                model: body?.model || 'default',
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
            // Stream stays open for next message
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
            // Stream stays open - client can send another message
          });

          // Start conversation
          logger.info('Starting agent and sending message', { requestId, message: body!.message });
          await agent.start();
          await agent.sendMessage(body!.message);
          logger.info('Message sent successfully', { requestId });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to process conversation';
          logger.error('Stream processing error:', { 
            requestId, 
            error: errorMessage, 
            stack: error instanceof Error ? error.stack : undefined 
          });
          
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: errorMessage,
                timestamp: new Date().toISOString(),
              })}\n\n`
            )
          );

          controller.close();
        }
      },

      cancel() {
        // Clean up if client disconnects - keep Agent alive for subsequent requests
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
    logger.error('API streaming conversation error:', {
      requestId,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      body: body || 'Failed to parse body',
    });

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
