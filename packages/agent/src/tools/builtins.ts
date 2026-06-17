// ABOUTME: Register lace's built-in (stateless) tools into the plugin tools registry
// ABOUTME: so a plugin name-clash is fatal at load. Option-taking tools (delegate, use_skill)
// ABOUTME: stay per-session in the executor; their names are guarded there.

import { registries } from '@lace/agent/plugins';
import { BashTool } from './implementations/bash';
import { RecallTool } from './implementations/recall';
import { FileReadTool } from './implementations/file_read';
import { FileWriteTool } from './implementations/file_write';
import { FileEditTool } from './implementations/file_edit';
import { RipgrepSearchTool } from './implementations/ripgrep_search';
import { FileFindTool } from './implementations/file_find';
import { UrlFetchTool } from './implementations/url_fetch';
import { JobOutputTool } from './implementations/job_output';
import { JobsListTool } from './implementations/jobs_list';
import { JobKillTool } from './implementations/job_kill';
import { JobNotifyTool } from './implementations/job_notify';
import { TodoReadTool } from './implementations/todo_read';
import { TodoWriteTool } from './implementations/todo_write';
import { ManageRemindersTool } from './implementations/manage_reminders';
import { CompactSessionTool } from './implementations/compact_session';
import { ReadToolResultTool } from './implementations/read_tool_result';

/** The per-session option-taking built-ins; the executor owns their names.
 *  'request_credential' is a host-only sen-core exec-tool, NOT a lace builtin. It is
 *  listed here ONLY to reserve the name so a persona tool cannot shadow it (Part B);
 *  the reservation does not make lace register a builtin under that name. */
export const PER_SESSION_BUILTIN_NAMES = new Set(['delegate', 'use_skill', 'request_credential']);

/**
 * Register all stateless built-in tools into the plugin tools registry (owner: 'builtin').
 *
 * Idempotent: checks for the presence of 'bash' in the registry rather than a module
 * flag, so this is safe to call again after resetRegistriesForTest() clears the registry.
 * Boot-time calls (from main.ts) and per-session calls (from registerAllAvailableTools)
 * are both harmless no-ops if the registry already contains the built-ins.
 */
export function registerBuiltinTools(): void {
  // Check for 'bash' as sentinel — if it's present, all built-ins are already registered.
  // This handles both the normal "only call once" path and the test path where
  // resetRegistriesForTest() clears the registry and we need to re-register.
  if (registries.tools.has('bash')) return;
  for (const t of [
    new BashTool(),
    new RecallTool(),
    new FileReadTool(),
    new FileWriteTool(),
    new FileEditTool(),
    new RipgrepSearchTool(),
    new FileFindTool(),
    new UrlFetchTool(),
    new JobOutputTool(),
    new JobsListTool(),
    new JobKillTool(),
    new JobNotifyTool(),
    new TodoReadTool(),
    new TodoWriteTool(),
    new ManageRemindersTool(),
    new CompactSessionTool(),
    new ReadToolResultTool(),
  ]) {
    registries.tools.register(t.name, t, 'builtin');
  }
}
