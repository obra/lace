import { posix, resolve as resolveHostPath } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { logger } from '../../utils/logger';
import type {
  ContainerHandle,
  ContainerLifecycleHooks,
  ContainerSpec,
} from '../../containers/spec';
import type { ExecStreamHandle, ExecStreamOptions } from '../../containers/types';
import { streamToString } from './container-exec-shared';
import { ContainerExecFileSystem } from './container-exec-fs';
import { ContainerExecNetworkClient } from './container-exec-network';
import {
  RuntimeSecretResolutionError,
  type RuntimeSecretResolver,
  redactSecretReference,
  resolveSecretEnv,
} from './secrets';
import type {
  RuntimeFileSystem,
  RuntimeNetworkClient,
  RuntimePath,
  RuntimePathService,
  RuntimeProcessHandle,
  RuntimeProcessOptions,
  RuntimeProcessResult,
  RuntimeProcessRunner,
  RuntimeSecretReference,
  ToolRuntime,
  ToolRuntimeDescriptor,
} from './types';

type ContainerToolRuntimeDescriptor = Extract<ToolRuntimeDescriptor, { type: 'container' }>;

export type ProjectedContainerToolRuntimeDescriptor = Omit<ContainerToolRuntimeDescriptor, 'type'>;

const CONTAINER_PLANE_SELECTOR_FIELDS = ['parentSession', 'childSession', 'jobId'] as const;
const CONTAINER_BROKER_SELECTOR_FIELDS = ['parentSessionId', 'childSessionId'] as const;
const CONTAINER_AUTHORITY_FIELDS = [
  'containerId',
  'ports',
  'restartPolicy',
  'sysctls',
  'capAdd',
  'network',
  'gatewayRoute',
] as const;

// The cleanup script itself sleeps two seconds between TERM and KILL.
const CONTAINER_CLEANUP_EXEC_TIMEOUT_MS = 10_000;

interface ProjectedContainerSecretContext {
  runtimeId: string;
  sessionId?: string;
  secretResolver?: RuntimeSecretResolver;
}

interface ProjectedHostMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface ProjectedContainerManager {
  materialize(spec: ContainerSpec, hooks?: ContainerLifecycleHooks): Promise<ContainerHandle>;
  execStream(specName: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;
}

function containerPathIsInside(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

function normalizeContainerPath(inputPath: string, cwd: string): string {
  if (posix.isAbsolute(inputPath)) {
    return posix.resolve(inputPath);
  }
  return posix.resolve(cwd, inputPath);
}

function pathRelativeToMount(containerPath: string, runtimePath: string): string {
  if (containerPath === '/') {
    return runtimePath.slice(1);
  }
  return posix.relative(containerPath, runtimePath);
}

function abortErrorFromSignal(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function definedEnvironment(
  base: Record<string, string> | undefined,
  override: NodeJS.ProcessEnv | undefined
): Record<string, string> | undefined {
  const environment: Record<string, string> = { ...(base ?? {}) };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return Object.keys(environment).length > 0 ? environment : undefined;
}

function hasDefinedField(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined;
}

function hasPlaneSelector(value: Record<string, unknown>): boolean {
  const hasBrokerSelector = CONTAINER_BROKER_SELECTOR_FIELDS.some((field) =>
    hasDefinedField(value, field)
  );
  return (
    CONTAINER_PLANE_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field)) ||
    (hasDefinedField(value, 'persona') && !hasBrokerSelector)
  );
}

function hasContainerSelector(value: Record<string, unknown>): boolean {
  return (
    hasDefinedField(value, 'persona') ||
    CONTAINER_PLANE_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field)) ||
    CONTAINER_BROKER_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field))
  );
}

function assertNoMixedSelectorAuthority(
  spec: ProjectedContainerToolRuntimeDescriptor['spec']
): void {
  const record = spec as Record<string, unknown>;
  const hasSelector = hasPlaneSelector(record);
  const hasAuthority = CONTAINER_AUTHORITY_FIELDS.some((field) => hasDefinedField(record, field));
  if (!hasSelector || !hasAuthority) return;

  throw new Error('Container selector fields cannot be combined with docker authority fields');
}

async function containerSpecFromDescriptor(
  descriptor: ProjectedContainerToolRuntimeDescriptor,
  secretContext: ProjectedContainerSecretContext
): Promise<ContainerSpec> {
  assertNoMixedSelectorAuthority(descriptor.spec);
  const secretEntries = Object.entries(descriptor.spec.secretEnv ?? {});
  const resolvedSecrets =
    secretEntries.length === 0
      ? {}
      : await resolveProjectedContainerSecrets(descriptor, secretContext, secretEntries);
  const mounts: ContainerSpec['mounts'] = descriptor.spec.mounts.map((mount) => ({
    source: mount.hostPath,
    target: mount.containerPath,
    readonly: mount.readonly,
  }));
  const spec: ContainerSpec = {
    name: descriptor.spec.name,
    image: descriptor.spec.image,
    workingDirectory: descriptor.spec.workingDirectory,
    mounts,
    env: { ...(descriptor.spec.env ?? {}), ...resolvedSecrets },
  };

  if (descriptor.spec.containerId) {
    spec.containerId = descriptor.spec.containerId;
  }
  const hasPlaneSelectors = hasPlaneSelector(descriptor.spec as Record<string, unknown>);
  if (!hasPlaneSelectors) {
    if (descriptor.spec.ports) {
      spec.ports = descriptor.spec.ports;
    }
    if (descriptor.spec.restartPolicy) {
      spec.restartPolicy = descriptor.spec.restartPolicy;
    }
    if (descriptor.spec.sysctls) {
      spec.sysctls = descriptor.spec.sysctls;
    }
    if (descriptor.spec.capAdd) {
      spec.capAdd = descriptor.spec.capAdd;
    }
    if (descriptor.spec.network) {
      spec.network = descriptor.spec.network;
    }
    if (descriptor.spec.gatewayRoute) {
      spec.gatewayRoute = descriptor.spec.gatewayRoute;
    }
  }
  // Selector fields — carried through to the ContainerSpec so the selected
  // runtime can read its own dialect.
  if (descriptor.spec.persona) {
    spec.persona = descriptor.spec.persona;
  }
  if (descriptor.spec.role) {
    spec.role = descriptor.spec.role;
  }
  if (descriptor.spec.parentSession) {
    spec.parentSession = descriptor.spec.parentSession;
  }
  if (descriptor.spec.childSession) {
    spec.childSession = descriptor.spec.childSession;
  }
  if (descriptor.spec.jobId) {
    spec.jobId = descriptor.spec.jobId;
  }
  if (descriptor.spec.parentSessionId) {
    spec.parentSessionId = descriptor.spec.parentSessionId;
  }
  if (descriptor.spec.childSessionId) {
    spec.childSessionId = descriptor.spec.childSessionId;
  }

  return spec;
}

async function resolveProjectedContainerSecrets(
  descriptor: ProjectedContainerToolRuntimeDescriptor,
  context: ProjectedContainerSecretContext,
  secretEntries: Array<[string, RuntimeSecretReference]>
): Promise<Record<string, string>> {
  const sessionId = context.sessionId ?? 'unknown';
  if (!context.secretResolver) {
    const [, reference] = secretEntries[0]!;
    throw new RuntimeSecretResolutionError(
      `Secret unavailable or unauthorized: ${redactSecretReference(reference)}`,
      {
        reference,
        runtimeId: context.runtimeId,
        sessionId,
      }
    );
  }

  return await resolveSecretEnv({
    secretEnv: descriptor.spec.secretEnv,
    resolver: context.secretResolver,
    runtimeId: context.runtimeId,
    sessionId,
  });
}

class ProjectedContainerPathService implements RuntimePathService {
  private readonly mounts: ProjectedHostMount[];

  constructor(
    private readonly runtimeId: string,
    private readonly cwd: string,
    mounts: ProjectedContainerToolRuntimeDescriptor['spec']['mounts']
  ) {
    this.mounts = normalizeHostMounts(mounts);
  }

  async resolve(inputPath: string): Promise<RuntimePath> {
    const runtimePath = normalizeContainerPath(inputPath, this.cwd);
    const mount = this.mounts.find((candidate) =>
      containerPathIsInside(candidate.containerPath, runtimePath)
    );
    const resolvedPath: RuntimePath = {
      original: inputPath,
      runtimePath,
      displayPath: inputPath,
    };

    if (mount) {
      resolvedPath.hostPath = resolveHostPath(
        mount.hostPath,
        pathRelativeToMount(mount.containerPath, runtimePath)
      );
    }

    return resolvedPath;
  }

  canonicalKey(path: RuntimePath): string {
    return `container:${this.runtimeId}:${posix.resolve(path.runtimePath)}`;
  }
}

function normalizeHostMounts(
  mounts: ProjectedContainerToolRuntimeDescriptor['spec']['mounts']
): ProjectedHostMount[] {
  return mounts
    .map((mount) => ({
      hostPath: resolveHostPath(mount.hostPath),
      containerPath: normalizeContainerPath(mount.containerPath, '/'),
      readonly: mount.readonly,
    }))
    .sort((left, right) => right.containerPath.length - left.containerPath.length);
}

/**
 * Tag a bare shell `-c` command with a unique $0 sentinel so the in-container
 * process group can be found (via /proc cmdline) and killed on abort. Killing
 * the exec-stream CLIENT does not touch the process inside the container; the
 * exec'd shell is its own process-group/session leader, so a negative-PGID signal
 * from a follow-up exec takes down the whole in-flight tree.
 *
 * Only the bare 3-element `sh|bash|dash -c <script>` shape is tagged — a
 * command that already passes $0 args (e.g. `sh -c '… "$0"' <path>`) is left
 * alone, as is any non-shell command.
 */
function tagShellCommandForKill(command: string[]): { command: string[]; killSentinel?: string } {
  if (command.length !== 3) return { command };
  const bin = command[0]?.split('/').pop();
  if (bin !== 'sh' && bin !== 'bash' && bin !== 'dash') return { command };
  if (!/^-(l?c|cl?)$/.test(command[1] ?? '')) return { command };
  const killSentinel = `lace-exec-${randomUUID()}`;
  // Keep the tagged outer shell alive even if the user's final command is
  // exec-optimized or explicitly uses exec. Both shells share its process group.
  const body = `(\n${command[2]}\n)\nstatus=$?\nexit "$status"`;
  return { command: [command[0]!, command[1]!, body, killSentinel], killSentinel };
}

class ProjectedContainerProcessRunner implements RuntimeProcessRunner {
  private materialized?: Promise<void>;

  constructor(
    private readonly descriptor: ProjectedContainerToolRuntimeDescriptor,
    private readonly containerManager: ProjectedContainerManager,
    private readonly secretContext: ProjectedContainerSecretContext
  ) {}

  private optionsFor(command: string[], opts: RuntimeProcessOptions = {}): ExecStreamOptions {
    if (command.length === 0) {
      throw new Error('runtime process command is empty');
    }

    const selectorBacked = hasContainerSelector(this.descriptor.spec as Record<string, unknown>);
    const baseEnvironment = selectorBacked ? this.descriptor.spec.env : undefined;

    return {
      command,
      workingDirectory: normalizeContainerPath(
        opts.cwd ?? this.descriptor.cwd,
        this.descriptor.cwd
      ),
      environment: definedEnvironment(baseEnvironment, opts.env),
      environmentMode: opts.envMode ?? 'inherit',
      longLived: opts.longLived,
    };
  }

  private async ensureMaterialized(): Promise<void> {
    if (this.materialized) {
      await this.materialized;
      return;
    }

    const materialized = (async () => {
      const spec = await containerSpecFromDescriptor(this.descriptor, this.secretContext);
      await this.containerManager.materialize(spec);
    })();
    this.materialized = materialized;

    try {
      await materialized;
    } catch (error) {
      if (this.materialized === materialized) {
        this.materialized = undefined;
      }
      throw error;
    }
  }

  async exec(command: string[], opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessResult> {
    const handle = await this.start(command, opts);
    const [stdout, stderr, completion] = await Promise.all([
      streamToString(handle.stdout),
      streamToString(handle.stderr),
      handle.completion,
    ]);
    return {
      exitCode: completion.exitCode ?? 0,
      stdout,
      stderr,
    };
  }

  async start(command: string[], opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessHandle> {
    if (opts.signal?.aborted) {
      opts.signal.throwIfAborted();
    }

    await this.ensureMaterialized();

    if (opts.signal?.aborted) {
      opts.signal.throwIfAborted();
    }

    const tagged = tagShellCommandForKill(command);
    const containerHandle = await this.containerManager.execStream(
      this.descriptor.spec.name,
      this.optionsFor(tagged.command, opts)
    );

    // Container execStream always wires a piped stdin (some callers, e.g. an
    // in-container MCP server, genuinely drive it — see ExecStreamHandle).
    // RuntimeProcessOptions.stdin defaults to 'ignore', so unless the caller
    // opted into 'pipe', end the pipe now: a live pipe nobody writes to or
    // closes would hang a command that falls back to reading stdin (e.g.
    // `head` with no file args). This matches the host runtime's 'ignore'.
    const stdinMode = opts.stdin === 'pipe' ? 'pipe' : 'ignore';
    if (stdinMode !== 'pipe') {
      containerHandle.stdin.on('error', () => {
        // Swallow EPIPE if the process exits before the end() below drains;
        // wait()/completion is the authoritative signal for the caller.
      });
      containerHandle.stdin.end();
    }

    let exited = false;
    const wait = containerHandle.wait().finally(() => {
      exited = true;
    });
    void wait.catch(() => {});
    let cleanup: Promise<void> | undefined;
    const killInContainerTree = (signal?: NodeJS.Signals): void => {
      if (!tagged.killSentinel) {
        containerHandle.kill(signal);
        return;
      }
      if (cleanup) return;
      // Keep the client alive until discovery/cleanup settles. A client closed
      // before Docker finishes launching is not evidence that no process ran.
      cleanup = this.killContainerProcessGroup(tagged.killSentinel, () => exited).finally(() =>
        containerHandle.kill(signal)
      );
      // The event handler cannot await; completion below owns the rejection.
      void cleanup.catch(() => {});
    };
    if (opts.signal?.aborted) {
      killInContainerTree();
      await Promise.all([wait, cleanup]);
      opts.signal.throwIfAborted();
    }

    let aborted = false;
    const abortHandler = () => {
      aborted = true;
      killInContainerTree();
    };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    const completion = (async () => {
      let result;
      try {
        result = await wait;
      } finally {
        try {
          await cleanup;
        } finally {
          opts.signal?.removeEventListener('abort', abortHandler);
        }
      }
      if (aborted) throw abortErrorFromSignal(opts.signal);
      return { exitCode: result.exitCode, signal: undefined };
    })();

    return {
      stdin: stdinMode === 'pipe' ? containerHandle.stdin : undefined,
      stdout: containerHandle.stdout,
      stderr: containerHandle.stderr,
      kill: (signal?: NodeJS.Signals) => {
        killInContainerTree(signal);
      },
      completion,
    };
  }

  /**
   * Terminate the groups of sentinel-tagged shells. Capture groups before TERM:
   * the shell may exit while a descendant ignores TERM and still needs KILL.
   * The bracket pattern excludes this cleanup command from its own lookup.
   * Completion reports lookup/signalling failures rather than claiming cleanup.
   */
  private async killContainerProcessGroup(
    sentinel: string,
    hasExited: () => boolean
  ): Promise<void> {
    const pattern = `[${sentinel[0]}]${sentinel.slice(1)}`;
    const script = `
command -v pgrep >/dev/null && command -v ps >/dev/null || exit 1
pids=$(pgrep -f "${pattern}"); status=$?
[ "$status" -eq 0 ] || [ "$status" -eq 1 ] || exit 1
groups=
for p in $pids; do
  case "$p" in ''|*[!0-9]*) exit 1 ;; esac
  group=$(ps -o pgid= -p "$p") || continue
  set -- $group
  [ "$#" -eq 1 ] || continue
  group=$1
  case "$group" in ''|*[!0-9]*) exit 1 ;; esac
  [ "$group" -gt 1 ] && [ "$group" != "$$" ] || exit 1
  case " $groups " in *" $group "*) ;; *) groups="$groups $group" ;; esac
done
[ -n "$groups" ] || exit 3
for group in $groups; do
  kill -TERM "-$group" 2>/dev/null || { kill -0 "-$group" 2>/dev/null && exit 1; }
done
sleep 2
for group in $groups; do
  kill -KILL "-$group" 2>/dev/null || { kill -0 "-$group" 2>/dev/null && exit 1; }
done
exit 0
`;
    try {
      const discoveryDeadline = Date.now() + 5000;
      while (true) {
        const handle = await this.containerManager.execStream(
          this.descriptor.spec.name,
          this.optionsFor(['sh', '-c', script])
        );
        handle.stdin.end();
        handle.stdout.resume();
        handle.stderr.resume();
        const result = await this.waitForCleanupExec(handle);
        if (result.exitCode === 0) return;
        if (result.exitCode !== 3) {
          throw new Error(`Container process-group cleanup failed (exit ${result.exitCode})`);
        }
        if (hasExited()) return;
        if (Date.now() >= discoveryDeadline) {
          throw new Error('Container process-group cleanup could not confirm process startup');
        }
        await delay(100);
      }
    } catch (error) {
      logger.warn('projected-container.tree-kill.failed', {
        spec: this.descriptor.spec.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * A cleanup exec that never returns (e.g. a stuck Docker daemon) must not
   * keep the cancelled command's completion pending forever.
   */
  private async waitForCleanupExec(handle: ExecStreamHandle): Promise<{ exitCode: number }> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        handle.kill('SIGKILL');
        reject(
          new Error(
            `Container process-group cleanup timed out after ${CONTAINER_CLEANUP_EXEC_TIMEOUT_MS}ms`
          )
        );
      }, CONTAINER_CLEANUP_EXEC_TIMEOUT_MS);
    });
    try {
      return await Promise.race([handle.wait(), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ProjectedContainerToolRuntime implements ToolRuntime {
  readonly kind = 'container' as const;
  readonly label = 'Projected Container';
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;

  constructor(input: {
    id: string;
    containerManager: ProjectedContainerManager;
    descriptor: ProjectedContainerToolRuntimeDescriptor;
    sessionId?: string;
    secretResolver?: RuntimeSecretResolver;
  }) {
    this.id = input.id;
    this.cwd = normalizeContainerPath(input.descriptor.cwd, input.descriptor.spec.workingDirectory);
    this.paths = new ProjectedContainerPathService(
      input.id,
      this.cwd,
      input.descriptor.spec.mounts
    );
    this.process = new ProjectedContainerProcessRunner(
      { ...input.descriptor, cwd: this.cwd },
      input.containerManager,
      {
        runtimeId: input.id,
        sessionId: input.sessionId,
        secretResolver: input.secretResolver,
      }
    );
    this.fs = new ContainerExecFileSystem(this.process);
    this.network = new ContainerExecNetworkClient(this.process);
  }

  readonly id: string;
  readonly cwd: string;
}
