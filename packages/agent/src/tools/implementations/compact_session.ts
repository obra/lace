// ABOUTME: compact_session built-in tool — schedules post-turn compaction
// ABOUTME: Mutates ctx.compactionRequest so the runner's post-turn block fires
// ABOUTME: the configured strategy after the turn ends. Does NOT compact mid-turn.

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const schema = z.object({
  guidance: z.string().min(1).optional(),
});

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
    // context. If the cell is absent (shouldn't happen at runtime — the runner
    // always seeds it), create it on ctx so the tool is still usable.
    if (ctx.compactionRequest) {
      ctx.compactionRequest.requested = true;
      if (args.guidance !== undefined) {
        ctx.compactionRequest.guidance = args.guidance;
      }
    } else {
      // Fallback: runner didn't seed the cell; create a new one.
      ctx.compactionRequest =
        args.guidance !== undefined
          ? { requested: true, guidance: args.guidance }
          : { requested: true };
    }

    const guidanceNote =
      args.guidance !== undefined ? ` Guidance recorded: "${args.guidance}".` : '';

    return this.createResult(
      `Compaction scheduled.${guidanceNote} ` +
        `Please end your turn now so the scheduled compaction can run before your next turn.`
    );
  }
}
