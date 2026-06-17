// ABOUTME: Pages the full output of a previously-digested tool result from its
// ABOUTME: per-session sidecar, sliced by head/tail/grep.

import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import { readToolResultSidecar } from '@lace/agent/storage/tool-result-store';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const readToolResultSchema = z
  .object({
    tool_call_id: NonEmptyString,
    head_lines: z.number().int().min(0).optional(),
    tail_lines: z.number().int().min(0).optional(),
    grep: z.string().optional(),
  })
  .strict();

export class ReadToolResultTool extends Tool {
  name = 'read_tool_result';
  description = `Fetch the full output of an earlier tool result that was **digested** out of context.

When a tool returns more than ~8 KB, the live transcript keeps only a head+tail digest and an elision marker; the complete payload is spilled to a per-session sidecar. Use this tool to page that sidecar back when the digest isn't enough.

Parameters:
- \`tool_call_id\` (required): the id from the elision marker of the digested result.
- \`grep\` (preferred for large outputs): return only lines containing this substring.
- \`head_lines\` / \`tail_lines\`: return the first / last N lines. With none given, a default head slice is returned.

Prefer \`grep\` over dumping head/tail for very large outputs so you pull only what you need. Returns a header (total bytes/lines + what slice) followed by the slice. **Read-only.**`;
  schema = readToolResultSchema;
  annotations: ToolAnnotations = {
    title: 'Read Tool Result',
    readOnlySafe: true,
    safeInternal: true,
  };

  protected async executeValidated(
    args: z.infer<typeof readToolResultSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const sessionId = context.activeSessionId;
    if (!sessionId) {
      return {
        status: 'failed',
        content: [
          {
            type: 'text',
            text: 'read_tool_result requires an active session, but none is set in context.',
          },
        ],
      };
    }

    const { tool_call_id, head_lines, tail_lines, grep } = args;

    let slice;
    try {
      slice = readToolResultSidecar(sessionId, tool_call_id, {
        headLines: head_lines,
        tailLines: tail_lines,
        grep,
      });
    } catch (err) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      };
    }

    const sliceDesc =
      grep !== undefined && grep !== ''
        ? `grep "${grep}" → ${slice.matchedLines ?? 0} matching line(s)${
            slice.grepCapped ? ' (capped)' : ''
          }`
        : describeHeadTail(head_lines, tail_lines);
    const header = `[tool_call_id=${tool_call_id} — ${slice.lineCount} lines, ${slice.totalBytes} bytes total — returning ${sliceDesc}]`;

    return {
      status: 'completed',
      content: [{ type: 'text', text: `${header}\n${slice.content}` }],
    };
  }
}

function describeHeadTail(headLines?: number, tailLines?: number): string {
  const parts: string[] = [];
  if (headLines !== undefined && headLines > 0) parts.push(`head ${headLines} line(s)`);
  if (tailLines !== undefined && tailLines > 0) parts.push(`tail ${tailLines} line(s)`);
  return parts.length > 0 ? parts.join(' + ') : 'default head slice';
}
