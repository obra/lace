// ABOUTME: Mock tool that simulates slow execution for testing abort functionality
// ABOUTME: Delays execution with configurable timeout and handles abort signals properly

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import type { ToolResult, ToolContext } from '~/tools/types';

const mockSlowSchema = z.object({
  delay: z.number().min(0).describe('Delay in milliseconds'),
  message: z.string().optional().describe('Message to return after delay'),
});

export class MockSlowTool extends Tool {
  name = 'mock_slow';
  description = 'Mock tool that simulates slow execution for testing';
  schema = mockSlowSchema;

  private partialOutput = '';

  protected async executeValidated(
    args: z.infer<typeof mockSlowSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { delay, message = 'Slow operation completed' } = args;
    const signal = context.signal;

    // Check if already aborted
    if (signal.aborted) {
      return this.createCancellationResult();
    }

    // Simulate work with ability to capture partial output
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms
    let elapsed = 0;

    return new Promise<ToolResult>((resolve) => {
      // Track partial progress
      this.partialOutput = `Started slow operation (${delay}ms delay)...`;

      const intervalId = setInterval(() => {
        elapsed = Date.now() - startTime;

        // Update partial output
        const progress = Math.min(100, Math.floor((elapsed / delay) * 100));
        this.partialOutput = `Processing... ${progress}% complete`;

        // Check if we've reached the delay or been aborted
        if (elapsed >= delay) {
          clearInterval(intervalId);
          signal.removeEventListener('abort', abortHandler);
          this.partialOutput = message;
          resolve(this.createResult(message));
        }
      }, checkInterval);

      // Handle abort signal
      const abortHandler = () => {
        clearInterval(intervalId);
        signal.removeEventListener('abort', abortHandler);
        const finalElapsed = Date.now() - startTime;
        const progress = Math.min(100, Math.floor((finalElapsed / delay) * 100));
        resolve(
          this.createCancellationResult(
            `Processing interrupted at ${progress}% (${finalElapsed}ms of ${delay}ms)`
          )
        );
      };

      signal.addEventListener('abort', abortHandler);

      // If delay is 0, resolve immediately
      if (delay === 0) {
        clearInterval(intervalId);
        signal.removeEventListener('abort', abortHandler);
        resolve(this.createResult(message));
      }
    });
  }
}
