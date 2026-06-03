// ABOUTME: compact_session built-in tool — schedules post-turn compaction
// ABOUTME: Mutates ctx.compactionRequest so the runner's post-turn block fires
// ABOUTME: the configured strategy after the turn ends. Does NOT compact mid-turn.

import { z } from 'zod';
import { Tool } from '../tool';
import { logger } from '@lace/agent/utils/logger';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const schema = z
  .object({
    guidance: z.string().min(1).optional(),
  })
  .strict();

export type CompactSessionInput = z.infer<typeof schema>;

const DESCRIPTION = [
  'Schedule a context compaction to run immediately after this turn ends.',
  '',
  'Call this when the context is getting long and you want the runtime to compact',
  'it before your next turn. The compaction runs AFTER you end your turn — it does',
  'not happen mid-turn.',
  '',
  'Optional `guidance`: a short string (e.g. "keep the open bug list and recent',
  'decisions") that the compaction strategy uses to bias what it preserves.',
  '',
  'After calling this tool, end your turn immediately so the compaction can run.',
].join('\n');

export class CompactSessionTool extends Tool {
  name = 'compact_session';
  description = DESCRIPTION;
  schema = schema;
  annotations: ToolAnnotations = {
    title: 'Schedule post-turn compaction',
    safeInternal: true,
  };

  protected async executeValidated(
    args: CompactSessionInput,
    ctx: ToolContext
  ): Promise<ToolResult> {
    // Mutate the per-turn cell in place so the runner's reference (which is
    // the same object) sees the update even after ToolExecutor spreads the
    // context. The runner always seeds the cell before the turn; if it is
    // absent something has gone wrong upstream — log a warning and fail rather
    // than fabricating a new object that the runner will never see.
    if (!ctx.compactionRequest) {
      logger.warn(
        'compact_session: ctx.compactionRequest not seeded by runner — cannot schedule compaction'
      );
      return this.createError(
        'Compaction could not be scheduled: the runtime did not initialise the compaction cell. This is a bug in the runner.'
      );
    }

    ctx.compactionRequest.requested = true;
    if (args.guidance !== undefined) {
      ctx.compactionRequest.guidance = args.guidance;
    }

    const guidanceNote =
      args.guidance !== undefined ? ` Guidance recorded: "${args.guidance}".` : '';

    return this.createResult(
      `Compaction scheduled.${guidanceNote} Please end your turn now so the scheduled compaction can run before your next turn.`
    );
  }
}
