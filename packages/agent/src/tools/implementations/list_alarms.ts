// ABOUTME: list_alarms tool — returns active alarms for the calling session.

import { z } from 'zod';
import { Tool } from '../tool';
import { formatAbsoluteTime } from '../../notifications/format-time';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const listSchema = z.object({}).strict();

export class ListAlarmsTool extends Tool {
  name = 'list_alarms';
  description =
    'List active alarms (pending or firing) for the current session, ordered by next_fire_at ascending.';
  schema = listSchema;
  annotations: ToolAnnotations = {
    title: 'List alarms',
    readOnlyHint: true,
    readOnlySafe: true,
    safeInternal: true,
  };

  protected async executeValidated(
    _args: z.infer<typeof listSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { alarmScheduler } = context;
    if (!alarmScheduler) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'list_alarms requires alarmScheduler in context' }],
      };
    }
    const rows = alarmScheduler.store.listActive();
    const alarms = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      schedule: r.schedule,
      prompt: r.prompt,
      timezone: r.timezone,
      status: r.status,
      next_fire_at_iso: formatAbsoluteTime(r.next_fire_at, r.timezone),
      created_at_iso: formatAbsoluteTime(r.created_at, r.timezone),
    }));
    return await Promise.resolve({
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify({ alarms }) }],
    });
  }
}
