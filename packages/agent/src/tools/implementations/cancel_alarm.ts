// ABOUTME: cancel_alarm tool — cancels a pending alarm by id in the calling session.

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const cancelSchema = z.object({ id: z.string().min(1) }).strict();

export class CancelAlarmTool extends Tool {
  name = 'cancel_alarm';
  description =
    'Cancel a pending alarm by id. Returns cancelled:true on success, or cancelled:false with a reason (not_found, already_fired, already_cancelled, firing).';
  schema = cancelSchema;
  annotations: ToolAnnotations = {
    title: 'Cancel an alarm',
    destructiveHint: true,
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof cancelSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler } = context;
    if (!alarmScheduler) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'cancel_alarm requires alarmScheduler in context' }],
      };
    }
    const result = alarmScheduler.store.cancel(args.id);
    return await Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify(result) }],
    });
  }
}
