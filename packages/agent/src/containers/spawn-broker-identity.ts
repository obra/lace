// ABOUTME: Broker-owned per-container identity lifecycle for the persona-spawn broker.
// ABOUTME: The broker is the SOLE minter/registrar/injector of each subagent's identity
// ABOUTME: token; an adversarial main-sen never sees or controls it (PRI-2012 Component B).

import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

function fingerprintContainerExecutionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// The literal env var name the persona container reads its execution token from
// (sen-core main.ts:1228 contract). The broker injects this; stripCallerToken
// removes any caller-supplied value so the caller can never override it.
const SEN_AGENT_TOKEN_ENV_NAME = 'SEN_AGENT_TOKEN';

// Base token TTL. Mirrors sen-core's DEFAULT_NONCE_TTL_MS (300_000 ms): the
// at-spawn registration covers the token/CONNECT path, which is short-lived and
// refreshed per-exec on a long-running persistent box (refreshOnExec).
export const DEFAULT_TOKEN_TTL_MS = 300_000;

// Enrichment / refresh TTL (1h): a re-registration (browser-CDP enrich,
// per-exec refresh, or adopt) must comfortably outlive any single job, so it
// gets a longer runtime-lifetime TTL than the base at-spawn one.
export const ENRICHMENT_TTL_MS = 60 * 60 * 1000;

// sen-core only accepts 'per_invocation' | 'persistent' for container_sharing.
export type ContainerSharing = 'per_invocation' | 'persistent';

export interface SpawnBrokerIdentityOptions {
  // Host path of the credential helper's SUBAGENT socket
  // (SEN_CREDENTIAL_HELPER_SOCKET_HOST_PATH).
  helperSocketPath: string;
  // Base at-spawn token TTL; defaults to DEFAULT_TOKEN_TTL_MS.
  tokenTtlMs?: number;
  // Enrichment / refresh TTL; defaults to ENRICHMENT_TTL_MS.
  enrichmentTtlMs?: number;
  nowMs?: () => number;
}

export interface RegisterAtSpawnInput {
  // The token MINTED before create() and injected into the container's create-env
  // (mintToken). Split from register so the canonical container id (create()'s
  // return value) is known before we register: mint → stamp env+labels → create →
  // register. Register still runs BEFORE start, so before any egress.
  token: string;
  // Registry-truth persona — NEVER caller-asserted.
  persona: string;
  parentSessionId: string;
  childSessionId: string;
  jobId: string;
  containerName: string;
  containerSharing: ContainerSharing;
  containerId?: string;
}

export interface EnrichOnAttachInput {
  containerName: string;
  browserCdpSocketPath?: string;
}

export interface RefreshOnExecInput {
  containerName: string;
  jobId: string;
}

// The broker's authoritative ownership record for one container's identity.
// Keyed by containerName in the in-memory map. The token PLAINTEXT lives here
// (and is injected into the container's create-env) but only the fingerprint +
// identity fields ever travel to the helper.
interface OwnershipRecord {
  // Raw token: present for containers THIS process spawned (injected into the
  // create-env). Absent after adoptRegistration — the adopted container still
  // carries its create-env token; the broker works from the fingerprint alone
  // (register/refresh need only the fingerprint).
  token?: string;
  fingerprint: string;
  persona: string;
  parentSessionId: string;
  childSessionId: string;
  jobId: string;
  containerName: string;
  containerSharing: ContainerSharing;
  containerId?: string;
  browserCdpUrl?: string;
}

export interface AdoptRegistrationInput {
  persona: string;
  parentSessionId: string;
  childSessionId: string;
  jobId: string;
  containerName: string;
  containerSharing: ContainerSharing;
  // The token fingerprint recovered from the container's sen.broker.tokenFingerprint
  // label. The raw token is NOT recoverable broker-side (only the container has
  // it) and not needed — register/refresh take the fingerprint.
  tokenFingerprint: string;
}

export class SpawnBrokerIdentity {
  private readonly helperSocketPath: string;
  private readonly tokenTtlMs: number;
  private readonly enrichmentTtlMs: number;
  private readonly nowMs: () => number;
  private readonly ownershipByContainerName = new Map<string, OwnershipRecord>();

  constructor(options: SpawnBrokerIdentityOptions) {
    this.helperSocketPath = options.helperSocketPath;
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.enrichmentTtlMs = options.enrichmentTtlMs ?? ENRICHMENT_TTL_MS;
    this.nowMs = options.nowMs ?? Date.now;
  }

  // Mint a fresh execution token. Byte-identical to lace job-manager.ts:219.
  mintToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // The fingerprint of a freshly-minted token, for stamping the
  // sen.broker.tokenFingerprint label BEFORE create() (and before the identity
  // record exists). Byte-identical to the helper's resolve-side fingerprint.
  fingerprintOf(token: string): string {
    return fingerprintContainerExecutionToken(token);
  }

  // Register the container's identity with the helper using a PRE-MINTED token
  // (mintToken). Split from minting so the canonical container id — create()'s
  // return value — is known and used here as containerName. This MUST be awaited
  // and complete BEFORE the container can egress: it is called after create() but
  // strictly before start() (a created-but-not-started container has no network),
  // and the returned promise resolves only after the helper acknowledges the
  // register_runtime request.
  async registerAtSpawn(input: RegisterAtSpawnInput): Promise<void> {
    const record: OwnershipRecord = {
      token: input.token,
      fingerprint: fingerprintContainerExecutionToken(input.token),
      persona: input.persona,
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      jobId: input.jobId,
      containerName: input.containerName,
      containerSharing: input.containerSharing,
    };
    if (input.containerId !== undefined) record.containerId = input.containerId;
    this.ownershipByContainerName.set(input.containerName, record);

    await this.sendRegisterRuntime(record, {
      expiresAtMs: this.nowMs() + this.tokenTtlMs,
    });
  }

  // Re-register the stored identity enriched with the browser CDP unix-socket
  // url (PRI-2002). The CDP socket name needs the materialized container, so it
  // rides this attach event rather than at-spawn. An explicit at-spawn
  // browserCdpUrl wins.
  async enrichOnAttach(input: EnrichOnAttachInput): Promise<void> {
    const record = this.requireRecord(input.containerName);
    if (record.browserCdpUrl === undefined && input.browserCdpSocketPath !== undefined) {
      record.browserCdpUrl = `unix:${input.browserCdpSocketPath}`;
    }
    await this.sendRegisterRuntime(record, {
      expiresAtMs: this.nowMs() + this.enrichmentTtlMs,
    });
  }

  // Refresh the TTL and re-attribute the per-job audit id on a shared
  // persistent box. Reuses the stored token/fingerprint/persona; only the
  // job_id and expires_at_ms change.
  async refreshOnExec(input: RefreshOnExecInput): Promise<void> {
    const record = this.requireRecord(input.containerName);
    record.jobId = input.jobId;
    await this.sendRegisterRuntime(record, {
      expiresAtMs: this.nowMs() + this.enrichmentTtlMs,
    });
  }

  // Rebuild + re-register an adopted container's identity from its recovered
  // labels (after a broker/helper restart). No raw token — the running container
  // still carries it in create-env; the broker registers via the fingerprint.
  async adoptRegistration(input: AdoptRegistrationInput): Promise<void> {
    const record: OwnershipRecord = {
      fingerprint: input.tokenFingerprint,
      persona: input.persona,
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      jobId: input.jobId,
      containerName: input.containerName,
      containerSharing: input.containerSharing,
    };
    this.ownershipByContainerName.set(input.containerName, record);
    await this.sendRegisterRuntime(record, {
      expiresAtMs: this.nowMs() + this.enrichmentTtlMs,
    });
  }

  // Return a copy of env with SEN_AGENT_TOKEN removed. Defense in depth: the
  // caller can never override the broker-injected token. Does not mutate input.
  stripCallerToken(env: Record<string, string>): Record<string, string> {
    const copy = { ...env };
    delete copy[SEN_AGENT_TOKEN_ENV_NAME];
    return copy;
  }

  private requireRecord(containerName: string): OwnershipRecord {
    const record = this.ownershipByContainerName.get(containerName);
    if (!record) {
      throw new Error(
        `spawn-broker-identity: no registered identity for container ${containerName}`
      );
    }
    return record;
  }

  // Build the snake_case register_runtime wire payload (sen-core
  // remote-runtime-registrar.ts buildRegisterRuntimeRequest), omitting absent
  // optionals, and send it over the helper socket. session_id is the PARENT
  // session id (sen-core lace-runtime-registration.ts uses parentSessionId).
  private async sendRegisterRuntime(
    record: OwnershipRecord,
    overrides: { expiresAtMs: number }
  ): Promise<void> {
    const request: Record<string, unknown> = {
      op: 'register_runtime',
      token_fingerprint: record.fingerprint,
      persona: record.persona,
      session_id: record.parentSessionId,
      job_id: record.jobId,
      expires_at_ms: overrides.expiresAtMs,
      container_sharing: record.containerSharing,
      container_name: record.containerName,
    };
    if (record.containerId !== undefined) request.container_id = record.containerId;
    if (record.browserCdpUrl !== undefined) request.browser_cdp_url = record.browserCdpUrl;

    const response = await requestJsonOverUnixSocket(this.helperSocketPath, request);
    if (response.ok !== true) {
      const error = typeof response.error === 'string' ? response.error : 'unknown_error';
      throw new Error(`register_runtime rejected: ${error}`);
    }
  }
}

// One-shot newline-delimited JSON request/response over the helper's unix
// socket. Reproduces sen-core admin-socket-client.ts requestJsonOverUnixSocket
// EXACTLY (write `${JSON.stringify(request)}\n` on connect; resolve the first
// newline-delimited JSON object). lace cannot import sen-core, so this is the
// reimplemented thin client for the register_runtime path.
function requestJsonOverUnixSocket(
  socketPath: string,
  request: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    socket.setEncoding('utf8');

    const cleanup = (): void => {
      socket.off('data', onData);
      socket.off('end', onIncomplete);
      socket.off('close', onIncomplete);
      socket.off('error', onError);
    };
    const settleResolve = (response: Record<string, unknown>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.end();
      resolve(response);
    };
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onData = (chunk: string): void => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        settleReject(new Error('helper_malformed_response'));
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        settleReject(new Error('helper_malformed_response'));
        return;
      }
      settleResolve(parsed as Record<string, unknown>);
    };
    const onIncomplete = (): void => {
      settleReject(new Error('helper_incomplete_response'));
    };
    const onError = (): void => {
      settleReject(new Error('helper_socket_error'));
    };

    socket.once('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', onData);
    socket.once('end', onIncomplete);
    socket.once('close', onIncomplete);
    socket.once('error', onError);
  });
}
