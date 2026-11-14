// ABOUTME: Memory-only credential env overlay on AgentServerState (PRI-3672).
// ABOUTME: Never persisted; read fresh at every tool call; entries can self-expire.

import type { AgentServerState } from '../server-types';

/**
 * One overlay entry. `expiresAt` is an epoch-millisecond timestamp; omit it
 * for an entry that lives until explicitly cleared or the process restarts.
 */
export type EnvOverlayEntry = {
  value: string;
  expiresAt?: number;
};

/**
 * Env var names whose value controls how a *process itself* behaves rather
 * than being read by application code — set one of these from the overlay
 * and the credential doesn't deliver a secret, it hijacks every subsequent
 * tool call in the session (prepend a directory to PATH, LD_PRELOAD a
 * shared object, inject Node CLI flags, etc.). sen-core's credential broker
 * validates `envVarAliases`/migrate's `env` param only for *shape*
 * (`^[A-Z_][A-Z0-9_]*$` — see sen-core-v2 helper-server.ts's
 * MIGRATE_ENV_VAR_PATTERN), not for safety, and the agent that calls
 * `request_credential(verb: 'migrate', env: ...)` chooses that name itself.
 * So lace is the only layer positioned to refuse a dangerous name before it
 * becomes a live env var in tool calls.
 *
 * Deliberately a fixed denylist, not an attempt at completeness: it covers
 * the mechanisms that are unambiguously about process/runtime hijacking
 * (dynamic loader search paths, interpreter options, shell startup hooks)
 * rather than ordinary credential delivery. Extend it if a new mechanism
 * shows up; don't treat its absence from this list as a safety guarantee for
 * novel attack surface.
 */
export const DANGEROUS_ENV_VAR_NAMES: ReadonlySet<string> = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NODE_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'PERL5LIB',
  'PERL5OPT',
  'RUBYOPT',
  'RUBYLIB',
  'BASH_ENV',
  'ENV',
  'SHELLOPTS',
  'IFS',
  'PROMPT_COMMAND',
  'GLOBIGNORE',
  'GIT_SSH_COMMAND',
  'GIT_SSL_CAINFO',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'HOME',
  'SHELL',
  'PAGER',
  'EDITOR',
  'JAVA_TOOL_OPTIONS',
  'GCONV_PATH',
  'ZDOTDIR',
]);

// GIT_CONFIG_COUNT, GIT_CONFIG_KEY_<n> and GIT_CONFIG_VALUE_<n> are an
// unbounded family (indexed by <n>), not a fixed set of names, so they can't
// live in DANGEROUS_ENV_VAR_NAMES as literal entries. Any of them injects
// arbitrary git config — including core.sshCommand/core.fsmonitor — into
// every git invocation a tool call makes, same hijack class as GIT_SSH_COMMAND.
//
// LD_ is the same story but for the dynamic loader: LD_PRELOAD and
// LD_LIBRARY_PATH are the famous ones, but LD_AUDIT, LD_ASSUME_KERNEL,
// LD_ORIGIN_PATH, LD_BIND_NOW, LD_SHOWAUXV, etc. all steer how the next
// process's dynamic linker behaves. Jesse's design-decision comment on PR
// #458 calls this out as "LD_* (prefix)" rather than a fixed literal list,
// so match the whole family instead of chasing new glibc tunables one at a
// time as they turn up.
const DANGEROUS_ENV_VAR_PREFIXES: readonly string[] = ['GIT_CONFIG_', 'LD_'];

export function isDangerousEnvVarName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    DANGEROUS_ENV_VAR_NAMES.has(upper) ||
    DANGEROUS_ENV_VAR_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

/**
 * Remove expired entries from `state.envOverlay` in place. Called by
 * `liveEnvOverlay` on every read (i.e. at every tool call — see runner.ts's
 * `executeToolByName`), so there is no separate timer or teardown hook: an
 * expired key simply stops being returned, and this prune call is what
 * actually drops it out of the map rather than leaving a dead entry behind.
 */
export function pruneExpiredEnvOverlay(state: AgentServerState, now: number = Date.now()): void {
  const overlay = state.envOverlay;
  if (!overlay) return;
  for (const [key, entry] of Object.entries(overlay)) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      delete overlay[key];
    }
  }
}

/**
 * The current, non-expired overlay as a plain `{ key: value }` map — the
 * shape `createRuntime`'s `env` param and `ToolContext.processEnv` both take.
 * Returns `undefined` when there is nothing live, so callers can
 * unconditionally spread it (`{ ...staticEnv, ...liveEnvOverlay(state) }`)
 * without accidentally introducing an empty-object truthy branch.
 */
export function liveEnvOverlay(
  state: AgentServerState,
  now: number = Date.now()
): Record<string, string> | undefined {
  pruneExpiredEnvOverlay(state, now);
  const overlay = state.envOverlay;
  if (!overlay) return undefined;
  const entries = Object.entries(overlay);
  if (entries.length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of entries) {
    result[key] = entry.value;
  }
  return result;
}
