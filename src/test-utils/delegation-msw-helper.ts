// ABOUTME: MSW-based test helper for delegation testing with realistic HTTP mocking
// ABOUTME: Replaces in-memory provider mocking with HTTP interception for clean provider testing

import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { beforeAll, afterAll, afterEach, vi } from 'vitest';

export interface DelegationMswOptions {
  baseUrl?: string;
  apiKey?: string;
  provider?: 'anthropic' | 'openai';
  responses?: string[];
}

export class DelegationMswHelper {
  private server: ReturnType<typeof setupServer>;
  private responses: string[] = [];
  private responseIndex = 0;
  private baseUrl: string;
  private apiKey: string;
  private provider: 'anthropic' | 'openai';

  constructor(options: DelegationMswOptions = {}) {
    this.baseUrl = options.baseUrl || 'https://api.anthropic.com';
    this.apiKey = options.apiKey || 'test-api-key';
    this.provider = options.provider || 'anthropic';
    this.responses = options.responses || ['Integration test completed successfully'];

    this.server = this.createMockServer();
  }

  private createMockServer() {
    if (this.provider === 'anthropic') {
      return this.createAnthropicServer();
    } else {
      return this.createOpenAIServer();
    }
  }

  private createAnthropicServer() {
    return setupServer(
      // Match all possible Anthropic API endpoints
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        const authHeader = request.headers.get('x-api-key');

        if (this.apiKey && authHeader !== this.apiKey) {
          return HttpResponse.json(
            { type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } },
            { status: 401 }
          );
        }

        // Parse request to detect task assignment
        const body = await request.json() as any;
        const messages = body.messages || [];
        
        // Look for task assignment in messages
        const hasTaskAssignment = messages.some((msg: any) => 
          msg.content && 
          typeof msg.content === 'string' && 
          (msg.content.includes('You have been assigned task') ||
           msg.content.includes('LACE TASK SYSTEM') ||
           msg.content.includes('TASK DETAILS'))
        );

        if (hasTaskAssignment) {
          // Extract task ID from messages if possible
          const taskMessage = messages.find((msg: any) => 
            msg.content && 
            typeof msg.content === 'string' && 
            msg.content.includes('You have been assigned task')
          );
          
          const taskId = taskMessage?.content?.match(/assigned task '([^']+)'/)?.at(1) || 'unknown';
          
          // Get response for this task
          const response = this.getNextResponse();
          
          // Return response with tool call to complete task
          return HttpResponse.json({
            id: 'msg_delegation_test',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `I'll complete this task: ${response}`,
              },
              {
                type: 'tool_use',
                id: 'delegation_task_complete',
                name: 'task_complete',
                input: {
                  id: taskId,
                  message: response,
                },
              },
            ],
            model: 'claude-3-5-haiku-20241022',
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: {
              input_tokens: 50,
              output_tokens: 30,
            },
          });
        }

        // Non-delegation response
        const response = this.getNextResponse();
        return HttpResponse.json({
          id: 'msg_test_response',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
          model: 'claude-3-5-haiku-20241022',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
        });
      })
    );
  }

  private createOpenAIServer() {
    return setupServer(
      http.post(`${this.baseUrl}/v1/chat/completions`, async ({ request }) => {
        const authHeader = request.headers.get('authorization');

        if (authHeader !== `Bearer ${this.apiKey}`) {
          return HttpResponse.json(
            { error: { message: 'Invalid API key', type: 'invalid_request_error' } },
            { status: 401 }
          );
        }

        // Parse request to detect task assignment
        const body = await request.json() as any;
        const messages = body.messages || [];
        
        // Look for task assignment in messages
        const hasTaskAssignment = messages.some((msg: any) => 
          msg.content && 
          typeof msg.content === 'string' && 
          (msg.content.includes('You have been assigned task') ||
           msg.content.includes('LACE TASK SYSTEM') ||
           msg.content.includes('TASK DETAILS'))
        );

        if (hasTaskAssignment) {
          // Extract task ID from messages if possible
          const taskMessage = messages.find((msg: any) => 
            msg.content && 
            typeof msg.content === 'string' && 
            msg.content.includes('You have been assigned task')
          );
          
          const taskId = taskMessage?.content?.match(/assigned task '([^']+)'/)?.at(1) || 'unknown';
          
          // Get response for this task
          const response = this.getNextResponse();
          
          // Return response with tool call to complete task
          return HttpResponse.json({
            id: 'chatcmpl_delegation_test',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `I'll complete this task: ${response}`,
                  tool_calls: [
                    {
                      id: 'delegation_task_complete',
                      type: 'function',
                      function: {
                        name: 'task_complete',
                        arguments: JSON.stringify({
                          id: taskId,
                          message: response,
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 30,
              total_tokens: 80,
            },
          });
        }

        // Non-delegation response
        const response = this.getNextResponse();
        return HttpResponse.json({
          id: 'chatcmpl_test_response',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: response,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });
      })
    );
  }

  private getNextResponse(): string {
    if (this.responses.length === 0) {
      return 'Mock delegation response';
    }

    const response = this.responses[this.responseIndex];
    this.responseIndex = (this.responseIndex + 1) % this.responses.length;
    return response;
  }

  setMockResponses(responses: string[]): void {
    this.responses = responses;
    this.responseIndex = 0;
  }

  setupServerLifecycle(): void {
    beforeAll(() => this.server.listen({ 
      onUnhandledRequest: 'warn',
    }));
    afterAll(() => this.server.close());
    afterEach(() => this.server.resetHandlers());
  }

  start(): void {
    // Use bypass option to avoid AbortSignal compatibility issues in Node.js test environment
    this.server.listen({ 
      onUnhandledRequest: 'bypass',
    });
  }

  stop(): void {
    this.server.close();
  }

  reset(): void {
    this.server.resetHandlers();
    this.responseIndex = 0;
  }

  // Helper for creating blocked task scenario
  setupBlockedTaskResponse(taskUpdateCallback?: (taskId: string) => void): void {
    // Override response to trigger task blocking
    if (this.provider === 'anthropic') {
      this.server.use(
        http.post(`${this.baseUrl}/v1/messages`, async ({ request }) => {
          const authHeader = request.headers.get('x-api-key');

          if (authHeader !== this.apiKey) {
            return HttpResponse.json(
              { type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } },
              { status: 401 }
            );
          }

          const body = await request.json() as any;
          const messages = body.messages || [];
          
          const taskMessage = messages.find((msg: any) => 
            msg.content && 
            typeof msg.content === 'string' && 
            msg.content.includes('You have been assigned task')
          );

          if (taskMessage) {
            const taskId = taskMessage?.content?.match(/assigned task '([^']+)'/)?.at(1) || 'unknown';
            
            // Call callback if provided (for test integration)
            if (taskUpdateCallback) {
              taskUpdateCallback(taskId);
            }

            // Return response that blocks the task
            return HttpResponse.json({
              id: 'msg_blocked_task',
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'I encountered an issue and cannot complete this task.',
                },
                {
                  type: 'tool_use',
                  id: 'task_update_call',
                  name: 'task_update',
                  input: {
                    taskId: taskId,
                    status: 'blocked',
                  },
                },
              ],
              model: 'claude-3-5-haiku-20241022',
              stop_reason: 'tool_use',
              stop_sequence: null,
              usage: {
                input_tokens: 50,
                output_tokens: 25,
              },
            });
          }

          // Fallback response
          return HttpResponse.json({
            id: 'msg_fallback',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Mock response' }],
            model: 'claude-3-5-haiku-20241022',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          });
        })
      );
    }
    // Similar pattern for OpenAI if needed
  }
}