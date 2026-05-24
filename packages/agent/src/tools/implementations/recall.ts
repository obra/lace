// ABOUTME: The `recall` built-in tool — episodic memory search and read
// ABOUTME: Two actions: search (FTS over transcripts) and read (expand a hit with context)

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const searchSchema = z.object({
  action: z.literal('search'),
  query: z.string().min(1),
  persona: z.union([z.string(), z.array(z.string())]).optional(),
  session_id: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const readSchema = z.object({
  action: z.literal('read'),
  event_id: z.string().min(1),
  context: z.number().int().nonnegative().max(50).optional(),
  full: z.boolean().optional(),
});

const recallSchema = z.discriminatedUnion('action', [searchSchema, readSchema]);

export type RecallSearchInput = z.infer<typeof searchSchema>;
export type RecallReadInput = z.infer<typeof readSchema>;
export type RecallInput = z.infer<typeof recallSchema>;

const RECALL_DESCRIPTION = [
  'Search your own past lace session transcripts — your episodic memory.',
  'Lexical search returns short previews of matching events; use `read` to expand any hit',
  'into surrounding context. This is a record of what happened, not the current state of the',
  'world; re-check live for facts that can change.',
  '',
  'Actions: `search`, `read`.',
].join('\n');

export class RecallTool extends Tool {
  name = 'recall';
  description = RECALL_DESCRIPTION;
  schema = recallSchema;
  annotations: ToolAnnotations = {
    title: 'Recall past session events',
    safeInternal: true,
    readOnlySafe: true,
  };

  protected async executeValidated(args: RecallInput, context: ToolContext): Promise<ToolResult> {
    if (args.action === 'search') {
      return this.search(args, context);
    }
    return this.read(args, context);
  }

  private async search(_args: RecallSearchInput, _context: ToolContext): Promise<ToolResult> {
    throw new Error('recall.search: not implemented');
  }

  private async read(_args: RecallReadInput, _context: ToolContext): Promise<ToolResult> {
    throw new Error('recall.read: not implemented');
  }
}
