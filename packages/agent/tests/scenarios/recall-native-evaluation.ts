// ABOUTME: Opt-in evaluation of root automatic recall with native workers against a private case copy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  MemoryRolesSchema,
  type EntAgentStatusResponseSchema,
  type HostMemoryBinding,
  type SessionRequestPermissionRequestSchema,
  type SessionUpdateNotificationSchema,
} from '@lace/ent-protocol';
import {
  claimMemoryOwner,
  configureMemoryRoles,
  openMemoryDatabase,
  readMemoryInstanceId,
} from '@lace/agent/memory/authority';
import { ENCODER_GENERATION } from '@lace/agent/memory/encoder';
import { originalHandle } from '@lace/agent/memory/types';
import { SCHEMA_VERSION as EVENT_INDEX_SCHEMA_VERSION } from '@lace/agent/storage/recall/index-db';
import { MAX_CONCURRENT_JOBS } from '@lace/agent/server-types';
import { z } from 'zod';
import { spawnAgentProcess, type SpawnedAgent } from '../../src/__tests__/helpers/agent-process.js';
import { defaultInitializeParams } from '../../src/__tests__/helpers/initialize.js';
import { recallCgroup, sampleRecallResources } from './recall-native-resources.js';

const workerRole = 'recall-evaluation-worker';
const markerFile = 'recall-evaluation-marker.txt';
const markerText = 'native recall evaluation file sentinel';
const markerContents = `${markerText}\n`;
const markerCommand = `cat ${markerFile}`;
const maintenanceFile = 'recall-evaluation-maintenance.md';
const syntheticSeed = 'recall-evaluation-seed.md';
const pathString = z.string().min(1);
const caseSchema = z
  .object({
    corpus: z.enum(['populated', 'synthetic']),
    caseDirectory: pathString,
    baselineDatabasePath: pathString.optional(),
    databasePath: pathString,
    laceDir: pathString,
    workspace: pathString,
    modelDirectory: pathString,
    searchUrl: z
      .string()
      .regex(/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/)
      .optional(),
    documentPaths: z.array(pathString).min(1),
    requiredFiles: z.array(pathString),
    expectedGitHead: z.string().regex(/^[a-f0-9]{40,64}$/),
    expectedPassages: z.number().int().positive(),
    expectedVectors: z.number().int().positive(),
    expectedGeneration: z.literal(ENCODER_GENERATION),
    cue: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./@-]{0,199}$/),
    query: z.string().trim().min(1).optional(),
    expectedOriginalHandle: z
      .string()
      .regex(/^source:[a-f0-9]{64}$/)
      .optional(),
    workers: z.number().int().min(1).max(MAX_CONCURRENT_JOBS),
  })
  .strict();
type Case = z.infer<typeof caseSchema>;
type CgroupUsage = ReturnType<NonNullable<ReturnType<typeof recallCgroup>>['usage']>;

export function reportFailedEvaluation(
  error: unknown,
  report: (phase: string, data?: object) => void,
  readUsage?: () => CgroupUsage,
  after?: CgroupUsage
): never {
  try {
    after ??= readUsage?.();
  } catch {
    // Cgroup counters may be unavailable after a process failure.
  }
  try {
    report('failed', after ? { after } : undefined);
  } catch {
    // Receipt errors must not replace the evaluation failure.
  }
  throw error;
}

function gitOutput(root: string, args: string[], input?: Buffer | string): Buffer {
  return execFileSync('git', ['-C', root, ...args], {
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

function git(root: string, ...args: string[]): string {
  return gitOutput(root, args).toString().trim();
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith('../') && !isAbsolute(child);
}

function workingPath(root: string, path: string, allowRoot = false): string {
  assert(isAbsolute(path), 'case paths must be absolute');
  const canonical = existsSync(path)
    ? realpathSync(path)
    : join(realpathSync(dirname(path)), relative(dirname(path), path));
  assert(
    within(root, canonical) || (allowRoot && canonical === root),
    'writable inputs must be inside the private case directory'
  );
  return canonical;
}

function privateCaseDirectory(path: string): string {
  assert(isAbsolute(path), 'case directory must be absolute');
  const root = realpathSync(path);
  const info = statSync(root);
  assert(
    info.isDirectory() && (info.mode & 0o077) === 0 && info.uid === process.getuid?.(),
    'case directory must be private and owned by the evaluator user'
  );
  return root;
}

function inspectCopy(input: Case, root: string) {
  const databasePath = workingPath(root, input.databasePath);
  const laceDir = workingPath(root, input.laceDir);
  const eventIndexPath = join(laceDir, 'recall', 'index.sqlite');
  const workspace = workingPath(root, input.workspace, true);
  assert.equal(
    git(workspace, 'rev-parse', '--show-toplevel'),
    workspace,
    'workspace must be a Git root'
  );
  assert.equal(git(workspace, 'rev-parse', 'HEAD'), input.expectedGitHead, 'unexpected Git HEAD');
  workingPath(root, git(workspace, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  for (const path of input.requiredFiles) {
    assert(!isAbsolute(path), 'required file paths must be relative to the case');
    assert(statSync(workingPath(root, resolve(root, path))).isFile(), 'required copy file missing');
  }
  assert(!existsSync(join(laceDir, 'ent-protocol.log')), 'Lace directory has already been used');
  assert(statSync(input.modelDirectory).isDirectory(), 'local model directory required');
  if (input.corpus === 'populated') {
    assert(
      input.baselineDatabasePath && input.expectedOriginalHandle && input.requiredFiles.length,
      'populated case needs the baseline, required files and expected original handle'
    );
    const baselinePath = realpathSync(input.baselineDatabasePath);
    assert(!within(root, baselinePath), 'baseline must be outside the writable case');
    const baseline = statSync(baselinePath);
    const copy = statSync(databasePath);
    assert(
      copy.isFile() && baseline.isFile() && copy.size === baseline.size,
      'backup copy size mismatch'
    );
    assert(
      copy.dev !== baseline.dev || copy.ino !== baseline.ino,
      'backup copy shares the baseline inode'
    );
    assert(
      !existsSync(`${databasePath}-wal`) && !existsSync(`${databasePath}-shm`),
      'begin with a consistent SQLite backup, without existing sidecars'
    );
    inspectEventIndex(workingPath(root, eventIndexPath), input.cue);
  } else {
    assert(!existsSync(databasePath), 'synthetic case needs a new memory database');
    assert(
      input.expectedPassages === 1 && input.expectedVectors === 1,
      'synthetic seed has one passage and vector'
    );
  }
  return { databasePath, laceDir, workspace, eventIndexPath };
}

export function inspectEventIndex(path: string, cue: string) {
  assert(
    existsSync(path) && !existsSync(`${path}-wal`) && !existsSync(`${path}-shm`),
    'populated case needs a checkpointed event index copy'
  );
  const index = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const schema = index
      .prepare("SELECT value FROM _meta WHERE key='schema_version'")
      .pluck()
      .get();
    assert.equal(
      schema,
      String(EVENT_INDEX_SCHEMA_VERSION),
      'event index would be rebuilt at startup'
    );
    assert(index.prepare('SELECT 1 FROM events LIMIT 1').get(), 'copied event index is empty');
    index
      .prepare('SELECT rowid, event_id FROM events WHERE events MATCH ? LIMIT 1')
      .get(`"${cue}"`);
  } finally {
    index.close();
  }
}

function privateBinding(databasePath: string, synthetic: boolean): HostMemoryBinding {
  const instanceId = synthetic ? randomUUID() : readMemoryInstanceId(databasePath);
  const authority = openMemoryDatabase(databasePath, instanceId, synthetic);
  let role: string;
  let roles: z.infer<typeof MemoryRolesSchema>;
  try {
    const stored = authority
      .prepare('SELECT root_role,role_grants FROM memory_authority WHERE singleton=1')
      .get() as {
      root_role: string | null;
      role_grants: string | null;
    };
    assert(synthetic || stored.root_role, 'populated backup must have a stored root role');
    role = stored.root_role ?? 'recall-evaluation-root';
    roles = MemoryRolesSchema.parse(JSON.parse(stored.role_grants ?? '{}'));
  } finally {
    authority.close();
  }
  assert(/^[A-Za-z0-9_-]+$/.test(role) && role !== workerRole, 'invalid fixture root role');
  assert(!Object.hasOwn(roles, workerRole), 'fixture worker role must be new');
  if (synthetic)
    roles[role] = {
      producerId: role,
      canRead: true,
      canMutate: true,
      collections: [],
      writableCollections: [],
    };
  const grant = roles[role];
  assert(grant?.canRead && grant.canMutate, 'stored root grant must allow normal maintenance');
  const binding = {
    ...grant,
    instanceId,
    role,
    actorId: role,
    isRoot: true,
    ownerGeneration: claimMemoryOwner(instanceId, databasePath, role, { create: false }),
  };
  const db = openMemoryDatabase(databasePath, instanceId, false);
  try {
    configureMemoryRoles(db, binding, roles);
  } finally {
    db.close();
  }
  return binding;
}

export function commitFixture(workspace: string, path: string, text: string): string {
  assert(path === syntheticSeed || path === maintenanceFile, 'expected a fixed root-level fixture');
  const parent = git(workspace, 'rev-parse', '--verify', 'HEAD^{commit}');
  assert(!git(workspace, 'ls-tree', '--name-only', parent, '--', path), 'fixture already exists');
  // Carry forward tree entries byte for byte, including references to omitted objects.
  const rootEntries = gitOutput(workspace, ['ls-tree', '-z', parent]);
  const blob = gitOutput(workspace, ['hash-object', '-w', '--stdin'], `${text}\n`)
    .toString()
    .trim();
  const entry = Buffer.from(`100644 blob ${blob}\t${path}\0`);
  const tree = gitOutput(
    workspace,
    ['mktree', '-z', '--missing'],
    Buffer.concat([rootEntries, entry])
  )
    .toString()
    .trim();
  const commit = git(
    workspace,
    '-c',
    'user.name=Lace Evaluation',
    '-c',
    'user.email=lace-evaluation@invalid',
    '-c',
    'commit.gpgSign=false',
    'commit-tree',
    tree,
    '-p',
    parent,
    '-m',
    'Add inert recall evaluation fixture'
  );
  git(workspace, 'update-ref', 'HEAD', commit, parent);
  return blob;
}

function coverage(db: Database.Database, input: Case) {
  const row = db
    .prepare(
      `
    SELECT count(*) AS passages, count(CASE WHEN p.generation=? AND p.vector IS NOT NULL
      THEN 1 END) AS vectors FROM memory_passages AS p
      JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
  `
    )
    .get(input.expectedGeneration);
  assert.deepEqual(
    row,
    { passages: input.expectedPassages, vectors: input.expectedVectors },
    'case corpus coverage mismatch'
  );
}

type Marker = { path: string; version: string };
const vectorPresent = `
  SELECT 1 FROM memory_sources AS s
  JOIN memory_passages AS p ON p.id=s.id AND p.version=s.version
  WHERE s.id=? AND s.version=? AND p.generation=? AND p.vector IS NOT NULL LIMIT 1
`;

async function waitForPublishedVector(databasePath: string, marker: Marker, signal: AbortSignal) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    const published = db.prepare(vectorPresent);
    while (!published.get(`document:${marker.path}`, marker.version, ENCODER_GENERATION)) {
      await delay(500, undefined, { signal });
    }
  } finally {
    db.close();
  }
}

export async function waitForSearchPublication(
  databasePath: string,
  generation: string,
  remoteIncarnation: (signal: AbortSignal) => Promise<string | undefined>,
  signal: AbortSignal,
  marker?: Marker
): Promise<string> {
  signal.throwIfAborted();
  const db = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    const initialized = db
      .prepare(
        `
      SELECT count(*)=2 FROM sqlite_schema
      WHERE type='table' AND name IN ('memory_search_state','memory_search_pending')
    `
      )
      .pluck();
    const ready = db.transaction(() => {
      if (!initialized.get()) return;
      const incarnation = db
        .prepare<[string], string>(
          `
        SELECT incarnation FROM memory_search_state
        WHERE singleton=1 AND generation=? AND incarnation IS NOT NULL AND seed_done=1
          AND NOT EXISTS (SELECT 1 FROM memory_search_pending)
      `
        )
        .pluck()
        .get(generation);
      if (
        incarnation &&
        (!marker ||
          db.prepare(vectorPresent).get(`document:${marker.path}`, marker.version, generation))
      )
        return incarnation;
    });
    for (;;) {
      signal.throwIfAborted();
      const incarnation = ready();
      if (incarnation) {
        const remote = await remoteIncarnation(signal);
        signal.throwIfAborted();
        // The local queue or seed can change while the remote collection is read.
        if (remote === incarnation && ready() === incarnation) return incarnation;
      }
      await delay(500, undefined, { signal });
    }
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    db.close();
  }
}

function searchCollection(url: string, instanceId: string, generation: string) {
  // Use the runtime's collection scope for a read-only check of the bound incarnation.
  const scope = createHash('sha256')
    .update(JSON.stringify([instanceId, generation]))
    .digest('hex');
  const collection = new URL(`/collections/lace-memory-${scope}`, url);
  const info = z.object({
    result: z.object({
      config: z.object({
        metadata: z.object({
          instanceId: z.literal(instanceId),
          generation: z.literal(generation),
          format: z.literal('lace-memory-search-v1'),
          incarnation: z.string().uuid(),
        }),
      }),
    }),
  });
  return async (signal: AbortSignal) => {
    const response = await fetch(collection, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return;
      throw new Error(`Search publication check failed with HTTP ${response.status}`);
    }
    const parsed = info.safeParse(await response.json());
    assert(parsed.success, 'search collection identity does not match the evaluation case');
    return parsed.data.result.config.metadata.incarnation;
  };
}

type Update = z.infer<typeof SessionUpdateNotificationSchema>['params'];
type Recall = {
  mode: string;
  reason?: string;
  coverage: { sources: number; passages: number; vectors: number; partial: boolean };
  durationMs: number;
  groups: number;
  reused: boolean;
  originals: string[];
  notes: string[];
};
type Round = Omit<Recall, 'reason'> & {
  observedMs: number;
  expectedOriginal: boolean;
  retrievalFailure: boolean;
};
type Turn = {
  startMs: number;
  endMs?: number;
  normal?: boolean;
  markerRead?: boolean;
  markerReply?: boolean;
  tools: number;
  rounds: Round[];
};

function recordNativeTurnUpdate(
  session: Map<string, Turn>,
  update: Update,
  timestamp: number,
  expectedHandle: string
) {
  const { turnId } = update;
  // Forwarded job updates are not the worker's own native frames.
  if (!turnId || update.jobId) return;
  if (update.type === 'turn_start')
    session.set(turnId, { startMs: timestamp, tools: 0, rounds: [] });
  const turn = session.get(turnId);
  if (!turn) return;
  const recall =
    update.type === 'session_info'
      ? (update._meta?.automaticRecall as Recall | undefined)
      : undefined;
  if (recall) {
    const { originals, notes, mode, reason, coverage, durationMs, groups, reused } = recall;
    turn.rounds.push({
      mode,
      coverage,
      durationMs,
      groups,
      reused,
      originals,
      notes,
      observedMs: timestamp,
      expectedOriginal: originals.includes(expectedHandle),
      retrievalFailure: reason !== undefined,
    });
  }
  if (update.type === 'tool_use' && update.status === 'completed') {
    const markerRead =
      update.name === 'bash' &&
      update.input.command === markerCommand &&
      update.result?.outcome === 'completed' &&
      update.result.content.some((part) => {
        if (part.type !== 'text') return false;
        try {
          const result = JSON.parse(part.text) as {
            exitCode?: number;
            stdoutPreview?: string;
          } | null;
          return result?.exitCode === 0 && result.stdoutPreview === markerContents;
        } catch {
          return false;
        }
      });
    if (markerRead) turn.markerRead = true;
    if (update.name === 'delegate' || markerRead) turn.tools++;
  }
  if (update.type === 'turn_end') {
    turn.endMs = timestamp;
    turn.normal =
      update.stopReason === 'end_turn' &&
      update.content.some((part) => part.type === 'text' && part.text.length > 0);
    turn.markerReply = update.content.some(
      (part) => part.type === 'text' && part.text.includes(markerText)
    );
  }
}

export async function readTurns(
  log: string,
  expectedHandle: string,
  expectedSessions: Set<string>
) {
  const turns = new Map<string, Map<string, Turn>>();
  const lines = createInterface({ input: createReadStream(log), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.slice(24, 29) !== ' OUT ') continue;
    const frame = JSON.parse(line.slice(29)) as { method?: string; params?: Update };
    if (frame.method !== 'session/update' || !frame.params) continue;
    const update = frame.params;
    const { sessionId, turnId } = update;
    if (!sessionId || !turnId || update.jobId || !expectedSessions.has(sessionId)) continue;
    const timestamp = Date.parse(line.slice(0, 24));
    const session = turns.get(sessionId) ?? new Map<string, Turn>();
    turns.set(sessionId, session);
    recordNativeTurnUpdate(session, update, timestamp, expectedHandle);
  }
  return turns;
}

export function assertTurn(
  turn: Turn | undefined,
  input: Pick<Case, 'expectedPassages' | 'expectedVectors'>,
  tools: number,
  worker = false
) {
  assert(turn?.endMs && turn.normal, 'turn did not complete with provider output');
  assert.equal(turn.tools, tools, 'required tool calls did not complete');
  if (worker) {
    assert(turn.markerRead, 'worker did not complete the marker read');
    assert(turn.markerReply, 'worker did not return the marker in its final reply');
    assert.equal(turn.rounds.length, 0, 'worker prepared automatic recall');
    return;
  }
  assert(
    turn.rounds.length >= (tools ? 2 : 1) &&
      turn.rounds[0].reused === false &&
      turn.rounds.slice(1).every((round) => round.reused),
    'turn must prepare fresh recall and reuse it in a tool result round'
  );
  for (const round of turn.rounds) {
    assert(!round.retrievalFailure, 'recall reported a retrieval failure');
    assert.equal(
      round.mode,
      'hybrid',
      'recall did not use the local encoder and textual retrieval'
    );
    assert(
      round.coverage.passages >= input.expectedPassages &&
        round.coverage.vectors >= input.expectedVectors,
      'recall did not cover the declared corpus'
    );
    assert(
      round.groups > 0 && round.expectedOriginal,
      'expected readable original was not supplied'
    );
  }
}

function peakTurnOverlap(turns: Turn[]) {
  const boundaries = turns.flatMap((turn) => [
    [turn.startMs, 1],
    [turn.endMs!, -1],
  ]);
  boundaries.sort(([a, deltaA], [b, deltaB]) => a - b || deltaA - deltaB);
  let active = 0;
  let peak = 0;
  for (const [, delta] of boundaries) peak = Math.max(peak, (active += delta));
  return peak;
}

export function assertWorkerOverlap(
  expected: number,
  peakTurns: number,
  peakNativeWorkers: number
) {
  assert.equal(peakTurns, expected, 'worker turn intervals did not all overlap');
  assert.equal(
    peakNativeWorkers,
    expected,
    'process samples did not see every worker alive together'
  );
}

type MaintenanceWindow = {
  workerObservedAtMs?: number;
  stagedAtMs: number;
  publishedObservedAtMs: number;
};

type PermissionRequest = Pick<
  z.infer<typeof SessionRequestPermissionRequestSchema>['params'],
  'jobId' | 'tool' | 'resource'
>;

export function coordinateWorkerReads(
  workers: number,
  started: ReadonlySet<string>,
  publish: (signal: AbortSignal) => Promise<MaintenanceWindow>
) {
  const waiting = new Set<string>();
  const controller = new AbortController();
  let released = false;
  let release!: (window: MaintenanceWindow) => void;
  let reject!: (error: unknown) => void;
  const maintenance = new Promise<MaintenanceWindow>((resolve, rejectMaintenance) => {
    release = resolve;
    reject = rejectMaintenance;
  });
  const allowed = { decision: 'allow' };
  const denied = { decision: 'deny' };
  const decision = maintenance.then(
    () => allowed,
    () => denied
  );
  const stop = (error: unknown) => {
    if (released || controller.signal.aborted) return;
    controller.abort(error);
    reject(error);
  };
  const request = async ({ jobId, tool, resource }: PermissionRequest) => {
    if (controller.signal.aborted) return denied;
    if (tool === 'delegate' && !jobId) return allowed;
    if (
      tool !== 'bash' ||
      resource !== markerCommand ||
      !jobId ||
      !started.has(jobId) ||
      waiting.has(jobId) ||
      waiting.size >= workers
    )
      return denied;

    waiting.add(jobId);
    if (waiting.size === workers) {
      // All requests share the same decision. Stop can deny them even during publication.
      void Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted();
          return publish(controller.signal);
        })
        .then((window) => {
          if (controller.signal.aborted) return;
          released = true;
          release(window);
        }, stop);
    }
    return decision;
  };
  const workerFinished = (jobId: string) => {
    if (started.has(jobId)) stop(new Error('worker finished before maintenance released its read'));
  };
  return { maintenance, request, stop, workerFinished };
}

export function observeRootIndexFailure(
  stderr: NodeJS.ReadableStream,
  fail: (error: Error) => void
) {
  const lines = createInterface({ input: stderr, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (
      /^ \[WARN\] memory\.(?:index\.(?:text-only|failed)|search\.(?:setup|publication)\.failed)(?: |$)/.test(
        line.slice(24)
      )
    )
      fail(new Error(line));
  });
  lines.on('error', fail);
  return () => lines.close();
}

export function workersDuringMaintenance(
  turns: Array<Pick<Turn, 'startMs' | 'endMs'>>,
  window: MaintenanceWindow
): number {
  const { workerObservedAtMs, stagedAtMs, publishedObservedAtMs } = window;
  if (
    workerObservedAtMs === undefined ||
    workerObservedAtMs > stagedAtMs ||
    stagedAtMs > publishedObservedAtMs
  )
    return 0;
  return turns.filter(
    ({ startMs, endMs }) =>
      startMs <= workerObservedAtMs && endMs !== undefined && endMs >= publishedObservedAtMs
  ).length;
}

async function waitForRootIdle(agent: SpawnedAgent, sessionId: string, signal: AbortSignal) {
  // Status exposes active turns and durable turn counts. A queued wake has no status field.
  type Status = z.infer<typeof EntAgentStatusResponseSchema>['result'];
  let previous: number | undefined;
  while (true) {
    const status = (await agent.peer.request('ent/agent/status')) as Status;
    assert.equal(status.currentSession?.sessionId, sessionId, 'root session changed');
    const idleTurns =
      status.currentTurn || status.pendingPermissions.length
        ? undefined
        : status.currentSession?.turnCount;
    if (idleTurns !== undefined && idleTurns === previous) return idleTurns;
    previous = idleTurns;
    await delay(500, undefined, { signal });
  }
}

function installedVersion(name: string, require = createRequire(import.meta.url)): string {
  let dir = dirname(require.resolve(name));
  while (dirname(dir) !== dir) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const { name: pkg, version } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg === name) return version as string;
    }
    dir = dirname(dir);
  }
  throw new Error(`Cannot identify installed ${name} version`);
}

async function run(input: Case, root: string) {
  const { databasePath, laceDir, workspace, eventIndexPath } = inspectCopy(input, root);
  const synthetic = input.corpus === 'synthetic';
  const cgroup = recallCgroup();
  if (!synthetic) {
    assert(cgroup, 'populated evaluation requires an isolated Linux cgroup v2');
    const [quota, period] = (cgroup.limits.cpuMax ?? '').split(/\s+/).map(Number);
    assert(
      Number(cgroup.limits.memoryMax) === 6 * 1024 ** 3 &&
        cgroup.limits.swapMax === '0' &&
        quota / period === 2,
      'populated evaluation requires 6 GiB, no swap, and two CPUs'
    );
  }
  const metrics = join(root, 'recall-evaluation-metrics.jsonl');
  const providerContext = join(root, 'recall-evaluation-provider-context.jsonl');
  writeFileSync(metrics, '', { flag: 'wx', mode: 0o600 });
  const report = (phase: string, data = {}) =>
    appendFileSync(metrics, `${JSON.stringify({ phase, timeMs: Date.now(), ...data })}\n`);
  const started = new Set<string>();
  const finished = new Map<string, string>();
  const reportJobsTerminal = () =>
    report('jobs_terminal', {
      started: started.size,
      finished: finished.size,
      completed: [...finished.values()].filter((outcome) => outcome === 'completed').length,
    });
  let agent: SpawnedAgent | undefined;
  let workerReads: ReturnType<typeof coordinateWorkerReads> | undefined;
  let stopObservingRootIndex: (() => void) | undefined;
  let stopListeningForCancellation: (() => void) | undefined;
  let sampler: ReturnType<typeof setInterval> | undefined;
  let samplingError: unknown;
  let after: CgroupUsage | undefined;
  let delegationStarted = false;
  let jobsTerminalReported = false;
  let failed = false;
  const abort = new AbortController();
  try {
    writeFileSync(providerContext, '', { flag: 'wx', mode: 0o600 });
    const before = cgroup?.usage();
    const binding = privateBinding(databasePath, synthetic);
    const remoteIncarnation = input.searchUrl
      ? searchCollection(input.searchUrl, binding.instanceId, input.expectedGeneration)
      : undefined;
    let seedVersion: string | undefined;
    if (synthetic)
      seedVersion = commitFixture(
        workspace,
        syntheticSeed,
        `Synthetic retained source for ${input.cue}.`
      );
    const expectedHandle =
      input.expectedOriginalHandle ??
      originalHandle({ id: `document:${syntheticSeed}`, version: seedVersion! });
    const documentPaths = [
      ...input.documentPaths,
      maintenanceFile,
      ...(synthetic ? [syntheticSeed] : []),
    ];
    writeFileSync(join(workspace, markerFile), markerContents, { flag: 'wx', mode: 0o600 });
    const personas = join(root, 'recall-evaluation-personas');
    mkdirSync(personas, { mode: 0o700 });
    for (const [role, tool] of [
      [binding.role, 'delegate'],
      [workerRole, 'bash'],
    ]) {
      writeFileSync(
        join(personas, `${role}.md`),
        `---\ntools:\n  - ${tool}\n---\nNative recall evaluation.\n`,
        { flag: 'wx', mode: 0o600 }
      );
    }
    report('start', {
      corpus: input.corpus,
      workers: input.workers,
      automaticRecall: 'root-only',
      retrieval: remoteIncarnation ? 'persistent-search' : 'exhaustive-baseline',
      approvalMode: 'ask',
      workerReadCoordination: remoteIncarnation
        ? 'bash permission held through SQLite and search publication'
        : 'bash permission held through SQLite vector publication',
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      sqliteAddon: installedVersion('better-sqlite3'),
      encoderLibrary: installedVersion('@huggingface/transformers'),
      onnxRuntime: installedVersion(
        'onnxruntime-node',
        createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'))
      ),
      encoderGeneration: ENCODER_GENERATION,
      limits: cgroup?.limits,
      before,
    });
    if (!synthetic) {
      const db = new Database(databasePath, { readonly: true, fileMustExist: true });
      try {
        coverage(db, input);
      } finally {
        db.close();
      }
    }
    let peakNativeWorkers = 0;
    const sample = () => {
      const resource = sampleRecallResources(agent?.proc.pid, databasePath, eventIndexPath, cgroup);
      const workers = resource.processes.filter((proc) => proc.pid !== agent?.proc.pid);
      peakNativeWorkers = Math.max(peakNativeWorkers, workers.length);
      report('sample', resource);
      return workers.length;
    };
    sample();
    agent = spawnAgentProcess({
      laceDir,
      stderrFile: join(root, 'recall-evaluation-root.stderr'),
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_DISABLE_DYNAMIC_CATALOGS: '1',
        LACE_TEST_PROVIDER_RESPECT_WIRE_TOOLS: '1',
        LACE_TEST_PROVIDER_DELEGATE_BATCH_SIZE: String(input.workers),
        LACE_TEST_PROVIDER_RECORD_CONTEXT: providerContext,
        LACE_LOG_LEVEL: 'debug',
        LACE_LOG_STDERR: 'true',
        LACE_PLUGINS: '',
        LACE_SESSION_DIR: '',
        // Use the native tool path without probing a host container runtime at startup.
        LACE_CONTAINER_RUNTIME: 'plane',
        LACE_DOCKER_BIN: '/dev/null',
      },
    });
    const { peer } = agent;
    const reads = coordinateWorkerReads(input.workers, started, async (signal) => {
      const sampledWorkers = sample();
      assert.equal(sampledWorkers, input.workers, 'process sample missed held workers');
      const workerObservedAtMs = Date.now();
      report('worker_reads_held', { sampledWorkers, workerObservedAtMs });
      const stagedAtMs = Date.now();
      const markerVersion = commitFixture(
        workspace,
        maintenanceFile,
        'Inert Markdown maintenance marker.'
      );
      report('maintenance_marker_committed', { stagedAtMs, workerObservedAtMs });
      // A normal durable append wakes root maintenance. A deferred continuation does not start a provider turn.
      await peer.request('ent/session/inject', {
        content: [{ type: 'text', text: 'Evaluation maintenance marker committed.' }],
        inputKind: 'continuation',
        priority: 'deferred',
      });
      signal.throwIfAborted();
      const marker = { path: maintenanceFile, version: markerVersion };
      let incarnation: string | undefined;
      if (remoteIncarnation) {
        incarnation = await waitForSearchPublication(
          databasePath,
          input.expectedGeneration,
          remoteIncarnation,
          signal,
          marker
        );
      } else {
        await waitForPublishedVector(databasePath, marker, signal);
      }
      signal.throwIfAborted();
      const publishedObservedAtMs = Date.now();
      report('maintenance_marker_published', { publishedObservedAtMs, incarnation });
      return { workerObservedAtMs, stagedAtMs, publishedObservedAtMs };
    });
    workerReads = reads;
    const abortRun = (error: unknown) => {
      abort.abort(error);
      reads.stop(error);
    };
    stopObservingRootIndex = observeRootIndexFailure(agent.proc.stderr, abortRun);
    const rootExited = (error: Error) => {
      abortRun(error);
      peer.close();
    };
    agent.proc.once('exit', (code, signal) =>
      rootExited(new Error(`root agent exited (code: ${code}, signal: ${signal})`))
    );
    agent.proc.once('error', rootExited);
    const cancelled = (signal: NodeJS.Signals) =>
      rootExited(new Error(`native evaluation cancelled by ${signal}`));
    process.once('SIGINT', cancelled);
    process.once('SIGTERM', cancelled);
    stopListeningForCancellation = () => {
      process.off('SIGINT', cancelled);
      process.off('SIGTERM', cancelled);
    };
    sampler = setInterval(() => {
      try {
        sample();
      } catch (error) {
        samplingError = error;
        abortRun(error);
        clearInterval(sampler);
        try {
          report('sampling_failed');
        } catch {
          // Keep the sampling error even if the receipt cannot be written.
        }
      }
    }, 500);
    const initialRootTurns = new Map<string, Turn>();
    let initialRootSession: string | undefined;
    peer.onRequest('session/update', async (params) => {
      const update = params as Update;
      if (initialRootSession && update.sessionId === initialRootSession)
        recordNativeTurnUpdate(initialRootTurns, update, Date.now(), expectedHandle);
      if (update.type === 'job_started' && update.jobType === 'delegate' && !update.parentJobId)
        started.add(update.jobId);
      if (update.type === 'job_finished' && started.has(update.jobId)) {
        finished.set(update.jobId, update.outcome);
        reads.workerFinished(update.jobId);
      }
    });
    peer.onRequest('session/request_permission', (params) =>
      reads.request(params as PermissionRequest)
    );
    const publicationStarted = performance.now();
    if (remoteIncarnation) report('initial_search_publication_started');
    await peer.request('initialize', {
      ...defaultInitializeParams(
        { config: { approvalMode: 'ask' } },
        { userPersonasPaths: [personas] }
      ),
      memory: {
        databasePath,
        binding,
        recall: {
          modelDirectory: realpathSync(input.modelDirectory),
          ...(input.searchUrl ? { search: { url: input.searchUrl } } : {}),
        },
        documentSources: { gitRoot: workspace, paths: documentPaths, extensions: ['.md'] },
      },
    });
    const seed = seedVersion ? { path: syntheticSeed, version: seedVersion } : undefined;
    if (remoteIncarnation) {
      const incarnation = await waitForSearchPublication(
        databasePath,
        input.expectedGeneration,
        remoteIncarnation,
        abort.signal,
        seed
      );
      report('initial_search_publication_ready', {
        generation: input.expectedGeneration,
        incarnation,
        durationMs: performance.now() - publicationStarted,
      });
    } else if (seed) {
      await waitForPublishedVector(databasePath, seed, abort.signal);
    }
    abort.signal.throwIfAborted();
    const { sessionId } = (await peer.request('session/new', {
      cwd: workspace,
      mcpServers: [],
      persona: binding.role,
    })) as { sessionId: string };
    const prompt = async (text: string) => {
      const result = (await peer.request('session/prompt', {
        content: [{ type: 'text', text }],
      })) as { stopReason: string; turnId: string };
      assert.equal(result.stopReason, 'end_turn', 'root prompt did not finish normally');
      assert(result.turnId, 'root prompt did not return a turn ID');
      return result.turnId;
    };
    report(synthetic ? 'root_synthetic_start' : 'root_copy_cold_start');
    const question = input.query ?? `Recall historical evidence for '${input.cue}'`;
    initialRootSession = sessionId;
    const firstTurn = await prompt(question);
    initialRootSession = undefined;
    const initialRootTurn = initialRootTurns.get(firstTurn);
    report('root_first_complete', { turn: initialRootTurn });
    abort.signal.throwIfAborted();
    assertTurn(initialRootTurn, input, 0);
    if (samplingError) throw samplingError;
    report('root_warm_and_workers_start');
    delegationStarted = true;
    const delegation = prompt(
      `subagent persona=${workerRole}: ${question} and run: ${markerCommand}`
    ).then((turnId) => {
      assert.equal(started.size, input.workers, 'delegate batch did not start all requested jobs');
      return turnId;
    });
    const [delegateTurn, maintenanceWindow] = await Promise.all([delegation, reads.maintenance]);
    while (finished.size < started.size) await delay(100, undefined, { signal: abort.signal });
    reportJobsTerminal();
    jobsTerminalReported = true;
    const { jobs } = (await peer.request('ent/job/list')) as {
      jobs: Array<{ jobId: string; status: string; subagentSessionId?: string }>;
    };
    const workers = jobs.filter((job) => started.has(job.jobId));
    assert.equal(workers.length, input.workers, 'delegate job list count mismatch');
    const workerSessions = new Set(
      workers.map((job) => {
        assert(
          job.subagentSessionId &&
            job.status === 'completed' &&
            finished.get(job.jobId) === 'completed',
          'delegate failed to complete a native child session'
        );
        return job.subagentSessionId;
      })
    );
    assert.equal(workerSessions.size, input.workers, 'delegates did not have distinct sessions');
    const idleTurns = await waitForRootIdle(agent, sessionId, abort.signal);
    report('root_idle_observed', { turns: idleTurns });
    if (samplingError) throw samplingError;
    assert.equal(sample(), 0, 'native workers are still running after job settlement');
    const turns = await readTurns(
      join(laceDir, 'ent-protocol.log'),
      expectedHandle,
      new Set([sessionId, ...workerSessions])
    );
    // A completed job can wake the root to report its result in a separate turn.
    const rootSessionTurns = turns.get(sessionId);
    assert.equal(
      rootSessionTurns?.size,
      idleTurns,
      'root protocol log does not account for every observed turn'
    );
    const rootTurns = [rootSessionTurns?.get(firstTurn), rootSessionTurns?.get(delegateTurn)];
    const notificationTurns = [...(rootSessionTurns ?? [])]
      .filter(([id]) => id !== firstTurn && id !== delegateTurn)
      .map(([, turn]) => turn);
    report('root_turns', { turns: rootTurns, notificationTurns });
    assertTurn(rootTurns[0], input, 0);
    assertTurn(rootTurns[1], input, input.workers);
    for (const turn of notificationTurns) {
      assert(
        turn.endMs &&
          turn.normal &&
          turn.rounds.length &&
          turn.rounds.every((round) => round.reused),
        'root notification turn did not finish with reused recall'
      );
    }
    const workerTurns: Turn[] = [];
    for (const worker of workerSessions) {
      const completed = [...(turns.get(worker)?.values() ?? [])];
      assert.equal(completed.length, 1, 'expected one turn per worker');
      report('worker_turn', { turn: completed[0] });
      assertTurn(completed[0], input, 1, true);
      workerTurns.push(completed[0]);
    }
    const contextRecord = z.object({
      pid: z.number().int().positive(),
      temporaryContext: z.string().nullable(),
    });
    const contexts = readFileSync(providerContext, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => contextRecord.parse(JSON.parse(line)));
    const rootPid = agent.proc.pid;
    assert(rootPid, 'root process ID unavailable');
    const rootContexts = contexts.filter(({ pid }) => pid === rootPid);
    const workerContexts = contexts.filter(({ pid }) => pid !== rootPid);
    const workerProcesses = new Set(workerContexts.map(({ pid }) => pid)).size;
    assert(
      rootContexts.some(({ temporaryContext }) => temporaryContext),
      'root evidence capture missing'
    );
    assert.equal(workerProcesses, input.workers, 'native worker context records missing');
    assert(
      workerContexts.every(({ temporaryContext }) => temporaryContext === null),
      'native worker provider received temporary context'
    );
    report('provider_context_recorded', { rootCalls: rootContexts.length, workerProcesses });
    const overlap = peakTurnOverlap(workerTurns);
    report('worker_overlap', { peakTurnOverlap: overlap, peakNativeWorkers });
    const workersCoveringMaintenance = workersDuringMaintenance(workerTurns, maintenanceWindow);
    report('maintenance_overlap', {
      ...maintenanceWindow,
      workersCoveringMaintenance,
      established: workersCoveringMaintenance === input.workers,
    });
    assertWorkerOverlap(input.workers, overlap, peakNativeWorkers);
    assert.equal(
      workersCoveringMaintenance,
      input.workers,
      'not every worker turn spanned the maintenance window'
    );
    after = cgroup?.usage();
    if (before && after) {
      for (const counter of ['oom', 'oom_kill', 'oom_group_kill']) {
        assert.equal(
          after.memoryEvents[counter],
          before.memoryEvents[counter],
          'cgroup OOM counter changed'
        );
      }
    }
    abort.signal.throwIfAborted();
    report('complete', { after });
  } catch (error) {
    failed = true;
    const failure = abort.signal.aborted ? abort.signal.reason : error;
    workerReads?.stop(failure);
    reportFailedEvaluation(failure, report, cgroup?.usage, after);
  } finally {
    stopListeningForCancellation?.();
    abort.abort();
    clearInterval(sampler);
    try {
      await agent?.shutdown().catch((error: unknown) => {
        if (!failed) throw error;
      });
    } finally {
      stopObservingRootIndex?.();
      if (delegationStarted && !jobsTerminalReported) {
        try {
          reportJobsTerminal();
        } catch {
          // A receipt write failure must not replace the primary error.
        }
      }
    }
  }
}

async function main() {
  let privateRoot: string | undefined;
  try {
    const configFile = process.argv[2];
    assert(
      configFile && process.argv.length === 3,
      'usage: node --import tsx recall-native-evaluation.ts <private case.json>'
    );
    const config: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
    privateRoot = privateCaseDirectory(
      caseSchema.pick({ caseDirectory: true }).strip().parse(config).caseDirectory
    );
    await run(caseSchema.parse(config), privateRoot);
  } catch (error) {
    let detailsSaved = false;
    if (privateRoot) {
      try {
        writeFileSync(
          join(privateRoot, 'recall-evaluation-error.log'),
          `${error instanceof Error ? error.stack : JSON.stringify(error)}\n`,
          { flag: 'wx', mode: 0o600 }
        );
        detailsSaved = true;
      } catch {
        // Never replace an earlier failure receipt or write outside the verified case.
      }
    }
    process.stderr.write(
      `Native recall evaluation failed.${detailsSaved ? ' See the private case error log.' : ''}\n`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
