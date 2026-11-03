// ABOUTME: `lace-agent reminders ensure`: lets a host process (sen-core's init stage) add a
// ABOUTME: recurring reminder to a session unless a matching cron reminder already exists.
// ABOUTME: Writes reminders.json through lace's own scheduler; run it while no server has the
// ABOUTME: session active (a live scheduler only picks the row up on its next reload).

import { isSessionId } from '@lace/ent-protocol';
import { existsSync, readFileSync } from 'node:fs';
import { getSessionDir } from '../storage/session-store';
import { assertCronAtLeast5MinInterval, getAgentTimezone } from './cron';
import { ReminderScheduler } from './scheduler';
import { ReminderStore } from './store';
import type { ReminderRow } from './types';

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

const USAGE = [
  "usage: lace-agent reminders ensure --session <sessionId> --cron '<expr>' --prompt-file <path> --match <text>",
  '',
  'Adds a cron reminder to the session unless one of its cron reminders already mentions <text>',
  '(case-insensitive). Prints one JSON line: {"status":"created"|"exists","id":...}.',
  'Exit codes: 0 ok, 1 invalid cron or cap reached, 2 session not found,',
  '3 reminders.json unreadable (left untouched), 64 usage.',
  'Run it while no lace server has the session active: a live scheduler keeps its schedule in',
  'memory and only picks up the new row when the session is next resumed or loaded.',
].join('\n');

const EXIT_INVALID = 1;
const EXIT_SESSION_NOT_FOUND = 2;
const EXIT_UNREADABLE_STORE = 3;
const EXIT_USAGE = 64;

type EnsureArgs = { session: string; cron: string; promptFile: string; match: string };

const ENSURE_FLAGS = new Set(['session', 'cron', 'prompt-file', 'match']);

/** Every flag known, given once, with a value; anything else is a usage error. */
function parseEnsureArgs(args: string[]): EnsureArgs | undefined {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) return undefined;
    const name = flag.slice(2);
    if (!ENSURE_FLAGS.has(name) || flags.has(name)) return undefined;
    flags.set(name, value);
  }
  const session = flags.get('session');
  const cron = flags.get('cron');
  const promptFile = flags.get('prompt-file');
  const match = flags.get('match');
  if (!session || !cron || !promptFile || !match) return undefined;
  return { session, cron, promptFile, match };
}

async function ensure(args: EnsureArgs, io: CliIo): Promise<number> {
  if (!isSessionId(args.session)) {
    io.stderr(`invalid session id: ${args.session}`);
    return EXIT_USAGE;
  }
  let sessionDir: string;
  try {
    sessionDir = getSessionDir(args.session);
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return EXIT_INVALID;
  }
  if (!existsSync(sessionDir)) {
    io.stderr(`session not found: ${args.session}`);
    return EXIT_SESSION_NOT_FOUND;
  }

  let rows: ReminderRow[];
  try {
    rows = new ReminderStore(sessionDir).listStrict();
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return EXIT_UNREADABLE_STORE;
  }

  const needle = args.match.toLowerCase();
  const existing = rows.find(
    (r) =>
      r.recurs?.kind === 'cron' &&
      typeof r.prompt === 'string' &&
      r.prompt.toLowerCase().includes(needle)
  );
  if (existing) {
    io.stdout(JSON.stringify({ status: 'exists', id: existing.id }));
    return 0;
  }

  let prompt: string;
  try {
    prompt = readFileSync(args.promptFile, 'utf8');
  } catch (err) {
    io.stderr(`cannot read prompt file: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_INVALID;
  }

  try {
    assertCronAtLeast5MinInterval(args.cron, getAgentTimezone());
    const scheduler = new ReminderScheduler({
      sessionDir,
      now: () => Date.now(),
      notifier: () => {},
    });
    const { id } = await scheduler.schedule({
      prompt,
      delaySeconds: null,
      recurs: { kind: 'cron', expr: args.cron },
    });
    io.stdout(JSON.stringify({ status: 'created', id }));
    return 0;
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return EXIT_INVALID;
  }
}

/** Entry for `lace-agent reminders <subcommand> ...`; returns the process exit code. */
export async function runRemindersCli(args: string[], io: CliIo): Promise<number> {
  const [subcommand, ...rest] = args;
  const parsed = subcommand === 'ensure' ? parseEnsureArgs(rest) : undefined;
  if (!parsed) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  return ensure(parsed, io);
}
