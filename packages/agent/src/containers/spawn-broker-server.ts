// ABOUTME: The persona-spawn broker server — holds docker.sock, exposes the closed
// ABOUTME: unix-socket API. Wires catalog (spec) + identity (token) + a ContainerRuntime;
// ABOUTME: owns ALL identity stamping + ownership enforcement on every non-spawn verb.

import net from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import type { ContainerRuntime, ContainerState } from './types';
import type { PersonaCatalog, PersonaName } from './spawn-broker-personas';
import { isPersonaName } from './spawn-broker-personas';
import type { SpawnBrokerIdentity, ContainerSharing } from './spawn-broker-identity';
import {
  parseSpawnBrokerRequest,
  SpawnBrokerProtocolError,
  type SpawnBrokerRequest,
  type SpawnResponse,
  type StopResponse,
  type DestroyResponse,
  type StatusResponse,
  type AdoptResponse,
  type ListResponse,
} from './spawn-broker-protocol';
import { StreamId, encodeFrame, encodeExitFrame, FrameDecoder } from './spawn-broker-stream-frames';

const SEN_AGENT_TOKEN_ENV_NAME = 'SEN_AGENT_TOKEN';

// The credential helper and the quarantined browser-driver share one host dir
// (the `sen-browser-cdp` named mount, container path `/sen-browser-cdp`); each
// container gets a uniquely-named socket on it. A TOP-LEVEL path (NOT under
// `/run`, which is itself the `sen-cred` mount) — a nested mount target inside
// another mount's destination fails at container init ("read-only file system").
const BROWSER_CDP_SOCKET_DIR = '/sen-browser-cdp';

function browserCdpSocketPath(containerName: string): string {
  return `${BROWSER_CDP_SOCKET_DIR}/${containerName}.sock`;
}

// The docker-label namespace the broker stamps identity into at create, so it
// can rebuild + re-validate its ownership record from `docker inspect` after a
// restart (the helper's in-memory registry doesn't survive a restart).
const LABEL = {
  persona: 'sen.broker.persona',
  parentSessionId: 'sen.broker.parentSessionId',
  childSessionId: 'sen.broker.childSessionId',
  jobId: 'sen.broker.jobId',
  tokenFingerprint: 'sen.broker.tokenFingerprint',
} as const;

const COMPONENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The broker's authoritative record of a container it owns. `token` (raw) is
 * present only for containers this broker process spawned; for adopted ones it's
 * absent (only the container itself still holds it, in its create-env) and the
 * broker works from the fingerprint. Keyed by containerName.
 */
interface OwnershipRecord {
  persona: PersonaName;
  parentSessionId: string;
  childSessionId: string;
  spawnJobId: string;
  containerSharing: ContainerSharing;
  containerName: string;
  token?: string;
}

export interface SpawnBrokerServerDeps {
  // The privileged docker runtime (DockerContainerRuntime in production). The
  // broker is the ONLY holder of docker access; main-sen has none.
  runtime: ContainerRuntime;
  catalog: PersonaCatalog;
  identity: SpawnBrokerIdentity;
  // Unix socket the broker listens on. main-sen reaches it through a mount; the
  // caller is treated as adversarial.
  socketPath: string;
}

export class SpawnBrokerServer {
  private readonly runtime: ContainerRuntime;
  private readonly catalog: PersonaCatalog;
  private readonly identity: SpawnBrokerIdentity;
  private readonly socketPath: string;
  private readonly owned = new Map<string, OwnershipRecord>();
  private server?: net.Server;

  constructor(deps: SpawnBrokerServerDeps) {
    this.runtime = deps.runtime;
    this.catalog = deps.catalog;
    this.identity = deps.identity;
    this.socketPath = deps.socketPath;
  }

  async listen(): Promise<void> {
    // The listen socket lives on a persistent volume, so a stale file survives a
    // hard-killed broker (SIGKILL skips net.Server.close()'s unlink). Remove it
    // before binding or listen() fails EADDRINUSE on every restart after the first.
    // ENOENT (fresh path) is fine; ignore it.
    await unlink(this.socketPath).catch(() => {});
    const server = net.createServer((socket) => this.onConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    // Operator-only socket surface; defense-in-depth beyond the mount topology.
    await chmod(this.socketPath, 0o600);
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    this.server = undefined;
  }

  // ── connection handling ────────────────────────────────────────────────
  // Every connection opens with one newline-delimited JSON control frame. For
  // lifecycle verbs that's the whole exchange (one request line → one response
  // line → close). For execStream the control frame is followed by the binary
  // frame protocol (see spawn-broker-stream-frames) on the same connection.

  private onConnection(socket: net.Socket): void {
    // NB: do NOT setEncoding('utf8'). The control frame is a newline-delimited
    // JSON line (ASCII), but for execStream the bytes that follow are the BINARY
    // frame protocol — utf8-decoding them would corrupt the length-prefix headers.
    // So accumulate raw Buffers, parse only the control-frame line as utf8, and
    // hand the remaining bytes on as a Buffer.
    let buffer: Buffer = Buffer.alloc(0);
    let consumedControlFrame = false;

    const onData = (chunk: Buffer): void => {
      if (consumedControlFrame) return; // execStream switches to its own listeners
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex === -1) return;
      consumedControlFrame = true;
      socket.off('data', onData);
      const line = buffer.subarray(0, newlineIndex).toString('utf8');
      const rest = buffer.subarray(newlineIndex + 1);
      void this.dispatch(socket, line, rest);
    };
    socket.on('data', onData);
    socket.on('error', () => socket.destroy());
  }

  private async dispatch(socket: net.Socket, line: string, rest: Buffer): Promise<void> {
    let request: SpawnBrokerRequest;
    try {
      request = parseSpawnBrokerRequest(JSON.parse(line));
    } catch (error) {
      const message =
        error instanceof SpawnBrokerProtocolError || error instanceof Error
          ? error.message
          : 'invalid request';
      this.replyJson(socket, { ok: false, error: message });
      return;
    }

    try {
      switch (request.op) {
        case 'spawn':
          this.replyJson(socket, await this.handleSpawn(request));
          return;
        case 'execStream':
          await this.handleExecStream(socket, request, rest);
          return;
        case 'stop':
          this.replyJson(socket, await this.handleStop(request));
          return;
        case 'destroy':
          this.replyJson(socket, await this.handleDestroy(request));
          return;
        case 'status':
          this.replyJson(socket, await this.handleStatus(request));
          return;
        case 'adopt':
          this.replyJson(socket, await this.handleAdopt(request));
          return;
        case 'list':
          this.replyJson(socket, await this.handleList());
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'broker error';
      this.replyJson(socket, { ok: false, error: message });
    }
  }

  private replyJson(socket: net.Socket, response: unknown): void {
    socket.write(`${JSON.stringify(response)}\n`);
    socket.end();
  }

  // Ownership guard: every non-spawn verb must name a container THIS broker owns.
  // Rejects the helper/arbiter/any foreign container — the broker only ever acts
  // on persona containers it spawned or adopted.
  private requireOwned(containerName: string): OwnershipRecord {
    const record = this.owned.get(containerName);
    if (!record) {
      throw new Error(`not a broker-owned container: ${containerName}`);
    }
    return record;
  }

  // ── spawn ───────────────────────────────────────────────────────────────
  private async handleSpawn(
    request: Extract<SpawnBrokerRequest, { op: 'spawn' }>
  ): Promise<SpawnResponse> {
    const { persona, parentSessionId, childSessionId, jobId } = request;

    // 1. Catalog builds the full spec from registry-truth (persona is a closed
    //    enum; the catalog supplies image/mounts/network/etc.). No identity here.
    const { config, containerSharing, browserCdpSocket } = this.catalog.buildSpawn(persona, {
      parentSessionId,
      childSessionId,
      jobId,
    });
    if (!config.name) {
      return { ok: false, error: 'catalog produced a config without a name' };
    }

    // 2. Mint the token BEFORE create — it must be in the create-env and its
    //    fingerprint in the sen.broker.* labels (which are stamped at create).
    //    persona is the registry-truth value from the catalog, never caller-asserted.
    const token = this.identity.mintToken();

    // 3. Server stamps the broker-minted token + the sen.broker.* ownership labels
    //    into the config (the catalog has no identity surface). Labels carry no
    //    container name, so they don't need the (post-create) canonical id.
    config.environment = { ...(config.environment ?? {}), [SEN_AGENT_TOKEN_ENV_NAME]: token };
    config.labels = {
      ...(config.labels ?? {}),
      [LABEL.persona]: persona,
      [LABEL.parentSessionId]: parentSessionId,
      [LABEL.childSessionId]: childSessionId,
      [LABEL.jobId]: jobId,
      [LABEL.tokenFingerprint]: this.identity.fingerprintOf(token),
    };

    // 4. Create → the CANONICAL container id. DockerContainerRuntime canonicalizes
    //    the name (resolveContainerName lace-prefixes it), so the broker MUST use
    //    create()'s RETURN value, never assume config.name — otherwise every
    //    subsequent verb (start/exec/ownership) misses the container. The container
    //    is created but NOT started, so it has no network and cannot egress yet.
    const containerName = await this.runtime.create(config);

    // 5-6. Register BEFORE start (= before egress) using the canonical
    //    containerName, record ownership, then start (start runs the netns-init
    //    sidecar when gatewayRoute set). A created-but-unstarted container has no
    //    route out, so register-before-egress holds even though register now runs
    //    after create. FAIL CLOSED on ANY post-create failure (register OR start):
    //    drop the ownership entry + remove the container so a spawn that didn't
    //    fully succeed leaves no owned/registered/never-started container behind.
    //    (The helper registration, if it landed, lapses via TTL — no unregister verb.)
    try {
      await this.identity.registerAtSpawn({
        token,
        persona,
        parentSessionId,
        childSessionId,
        jobId,
        containerName,
        containerSharing,
        ...(config.id ? { containerId: config.id } : {}),
      });
      this.owned.set(containerName, {
        persona,
        parentSessionId,
        childSessionId,
        spawnJobId: jobId,
        containerSharing,
        containerName,
        token,
      });
      await this.runtime.start(containerName);
    } catch (error) {
      this.owned.delete(containerName);
      await this.runtime.remove(containerName).catch(() => {});
      throw error;
    }

    // 7. Browser-CDP enrichment: for browserCdpSocket personas, learn the
    //    per-spawn CDP socket path and re-register enriched. The CDP socket name
    //    needs the materialized container, so it can't ride the at-spawn register.
    if (browserCdpSocket && this.owned.has(containerName)) {
      await this.identity.enrichOnAttach({
        containerName,
        browserCdpSocketPath: browserCdpSocketPath(containerName),
      });
    }

    const state = await this.currentState(containerName);
    return { ok: true, containerName, state, resolvedMounts: config.mounts };
  }

  private async currentState(containerName: string): Promise<ContainerState> {
    const info = await this.runtime.daemonInspect(containerName);
    return info?.state ?? 'running';
  }

  // ── execStream ────────────────────────────────────────────────────────────
  private async handleExecStream(
    socket: net.Socket,
    request: Extract<SpawnBrokerRequest, { op: 'execStream' }>,
    rest: Buffer
  ): Promise<void> {
    let record: OwnershipRecord;
    try {
      record = this.requireOwned(request.containerName);
    } catch (error) {
      this.replyJson(socket, {
        ok: false,
        error: error instanceof Error ? error.message : 'ownership check failed',
      });
      return;
    }

    // Strip any caller-supplied token, then inject the broker's. For an adopted
    // container (no raw token broker-side), rely on the container's persisted
    // create-env token via inherit; a 'replace' env mode can't be satisfied →
    // explicit error (no hidden fallback).
    const callerEnv = this.stripCallerToken(request.environment);
    const environmentMode = request.environmentMode ?? 'inherit';
    let environment: Record<string, string> = callerEnv;
    if (record.token !== undefined) {
      environment = { ...callerEnv, [SEN_AGENT_TOKEN_ENV_NAME]: record.token };
    } else if (environmentMode === 'replace') {
      this.replyJson(socket, {
        ok: false,
        error:
          `container ${request.containerName} was adopted; broker cannot re-supply ` +
          `SEN_AGENT_TOKEN under environmentMode 'replace'. Recreate it to use replace-mode env.`,
      });
      return;
    }

    // Refresh the registration TTL + re-attribute the per-job audit id. jobId
    // falls back to the spawn jobId when the caller didn't thread the current one.
    await this.identity.refreshOnExec({
      containerName: request.containerName,
      jobId: request.jobId ?? record.spawnJobId,
    });

    const handle = await this.runtime.execStream(request.containerName, {
      command: request.command,
      environment,
      environmentMode,
      ...(request.workingDirectory ? { workingDirectory: request.workingDirectory } : {}),
    });

    this.bridgeExecStream(socket, handle, rest);
  }

  // Pipe a docker exec's stdio over the dedicated connection using the binary
  // frame protocol: caller stdin frames → handle.stdin; handle.stdout/stderr →
  // stdout/stderr frames; on completion an exit frame, then close. Caller closing
  // the connection kills the exec.
  private bridgeExecStream(
    socket: net.Socket,
    handle: {
      stdin: NodeJS.WritableStream;
      stdout: NodeJS.ReadableStream;
      stderr: NodeJS.ReadableStream;
      wait(): Promise<{ exitCode: number }>;
      kill(signal?: NodeJS.Signals): void;
    },
    rest: Buffer
  ): void {
    let finished = false;
    const decoder = new FrameDecoder();

    const feedStdin = (chunk: Buffer): void => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch {
        handle.kill();
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        if (frame.streamId === StreamId.STDIN) {
          if (frame.payload.length === 0) handle.stdin.end();
          else handle.stdin.write(frame.payload);
        }
      }
    };

    // The bytes already buffered after the control frame are the first stdin data
    // (raw Buffer — the connection is never utf8-decoded, so frames stay intact).
    if (rest.length > 0) feedStdin(rest);
    socket.on('data', (chunk: Buffer) => feedStdin(chunk));

    handle.stdout.on('data', (chunk: Buffer) => socket.write(encodeFrame(StreamId.STDOUT, chunk)));
    handle.stderr.on('data', (chunk: Buffer) => socket.write(encodeFrame(StreamId.STDERR, chunk)));

    const onClose = (): void => {
      if (finished) return;
      finished = true;
      handle.kill();
    };
    socket.on('close', onClose);

    void handle
      .wait()
      .then(({ exitCode }) => {
        if (finished) return;
        finished = true;
        socket.off('close', onClose);
        socket.write(encodeExitFrame(exitCode));
        socket.end();
      })
      .catch(() => {
        if (finished) return;
        finished = true;
        socket.destroy();
      });
  }

  private stripCallerToken(env: Record<string, string> | undefined): Record<string, string> {
    const copy = { ...(env ?? {}) };
    delete copy[SEN_AGENT_TOKEN_ENV_NAME];
    return copy;
  }

  // ── stop / destroy / status / list ─────────────────────────────────────────
  private async handleStop(
    request: Extract<SpawnBrokerRequest, { op: 'stop' }>
  ): Promise<StopResponse> {
    this.requireOwned(request.containerName);
    await this.runtime.stop(request.containerName, request.timeoutSeconds);
    return { ok: true };
  }

  private async handleDestroy(
    request: Extract<SpawnBrokerRequest, { op: 'destroy' }>
  ): Promise<DestroyResponse> {
    this.requireOwned(request.containerName);
    await this.runtime.remove(request.containerName);
    this.owned.delete(request.containerName);
    return { ok: true };
  }

  private async handleStatus(
    request: Extract<SpawnBrokerRequest, { op: 'status' }>
  ): Promise<StatusResponse> {
    this.requireOwned(request.containerName);
    const info = await this.runtime.daemonInspect(request.containerName);
    if (!info) return { ok: true, exists: false };
    return {
      ok: true,
      exists: true,
      info: {
        id: info.id,
        state: info.state,
        ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
        ...(info.mounts ? { mounts: info.mounts } : {}),
      },
    };
  }

  private async handleList(): Promise<ListResponse> {
    // Report the REAL daemon state per owned container (not a hardcoded value) so
    // a container that exited unexpectedly isn't reported as running. Ownership-
    // scoped: only the containers this broker spawned/adopted.
    const containers = await Promise.all(
      Array.from(this.owned.values()).map(async (r) => {
        const info = await this.runtime.daemonInspect(r.containerName);
        return { id: r.containerName, state: (info?.state ?? 'stopped') as ContainerState };
      })
    );
    return { ok: true, containers };
  }

  // ── adopt ───────────────────────────────────────────────────────────────
  // Reattach an existing (persistent) container after a broker/helper restart.
  // The ownership record is rebuilt + re-validated ENTIRELY from the container's
  // sen.broker.* docker labels (read via daemonInspect), then re-registered with
  // the helper. A foreign container (no/partial sen.broker.* labels, or a persona
  // not in the catalog) is rejected — this is how the helper/arbiter container can
  // never be adopted.
  private async handleAdopt(
    request: Extract<SpawnBrokerRequest, { op: 'adopt' }>
  ): Promise<AdoptResponse> {
    const info = await this.runtime.daemonInspect(request.containerName);
    if (!info) return { ok: false, error: `no such container: ${request.containerName}` };

    const labels = info.labels ?? {};
    const persona = labels[LABEL.persona];
    const parentSessionId = labels[LABEL.parentSessionId];
    const childSessionId = labels[LABEL.childSessionId];
    const jobId = labels[LABEL.jobId];
    const tokenFingerprint = labels[LABEL.tokenFingerprint];

    // Validate EVERY label field (not just "labels present"): persona ∈ the closed
    // catalog enum, ids path-safe + length-capped, all five present. Anything else
    // → reject. A forged/partial-label or non-persona container cannot be adopted.
    if (
      persona === undefined ||
      parentSessionId === undefined ||
      childSessionId === undefined ||
      jobId === undefined ||
      tokenFingerprint === undefined
    ) {
      return {
        ok: false,
        error: `container ${request.containerName} is missing sen.broker.* labels`,
      };
    }
    if (!isPersonaName(persona)) {
      return { ok: false, error: `label persona '${persona}' is not a known persona` };
    }
    if (!COMPONENT_ID_RE.test(parentSessionId) || !COMPONENT_ID_RE.test(childSessionId)) {
      return { ok: false, error: `unsafe session id label on ${request.containerName}` };
    }
    if (jobId.length < 1 || jobId.length > 64) {
      return { ok: false, error: `invalid jobId label length on ${request.containerName}` };
    }
    if (!/^[a-f0-9]{64}$/.test(tokenFingerprint)) {
      return { ok: false, error: `invalid tokenFingerprint label on ${request.containerName}` };
    }

    const containerSharing: ContainerSharing =
      info.state === 'running' ? 'persistent' : 'persistent';

    await this.identity.adoptRegistration({
      persona,
      parentSessionId,
      childSessionId,
      jobId,
      containerName: request.containerName,
      containerSharing,
      tokenFingerprint,
    });

    await this.runtime.adopt(
      {
        id: info.id,
        name: request.containerName,
        image: '',
        workingDirectory: '/',
        mounts: info.mounts ?? [],
      },
      info.state
    );

    this.owned.set(request.containerName, {
      persona,
      parentSessionId,
      childSessionId,
      spawnJobId: jobId,
      containerSharing,
      containerName: request.containerName,
      // raw token absent on adopt — the container still carries it in create-env.
    });

    return {
      ok: true,
      containerName: request.containerName,
      state: info.state,
      resolvedMounts: info.mounts ?? [],
    };
  }
}
