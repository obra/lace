import type { RuntimeSecretReference } from './types';

export interface RuntimeSecretResolutionRequest {
  reference: RuntimeSecretReference;
  runtimeId: string;
  sessionId: string;
  jobId?: string;
  serverId?: string;
}

export interface RuntimeSecretResolver {
  resolve(request: RuntimeSecretResolutionRequest): Promise<string>;
}

export class RuntimeSecretResolutionError extends Error {
  public readonly redactedReference: string;
  public readonly runtimeId: string;
  public readonly sessionId: string;
  public readonly jobId?: string;
  public readonly serverId?: string;

  constructor(message: string, request: RuntimeSecretResolutionRequest) {
    super(message);
    this.name = 'RuntimeSecretResolutionError';
    this.redactedReference = redactSecretReference(request.reference);
    this.runtimeId = request.runtimeId;
    this.sessionId = request.sessionId;
    this.jobId = request.jobId;
    this.serverId = request.serverId;
  }
}

export function redactSecretReference(reference: RuntimeSecretReference): string {
  return `[secret:${reference.namespace}:REDACTED]`;
}

export class InMemoryRuntimeSecretResolver implements RuntimeSecretResolver {
  constructor(private readonly values: Record<string, string>) {}

  async resolve(request: RuntimeSecretResolutionRequest): Promise<string> {
    const key = `${request.reference.namespace}:${request.reference.name}`;
    const value = this.values[key];
    if (value === undefined) {
      throw new RuntimeSecretResolutionError(
        `Secret unavailable or unauthorized: ${redactSecretReference(request.reference)}`,
        request
      );
    }
    return value;
  }
}

function normalizeSecretEnvSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function environmentKeyForSecretReference(reference: RuntimeSecretReference): string {
  return `LACE_SECRET_${normalizeSecretEnvSegment(reference.namespace)}_${normalizeSecretEnvSegment(
    reference.name
  )}`;
}

export class EnvironmentRuntimeSecretResolver implements RuntimeSecretResolver {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  async resolve(request: RuntimeSecretResolutionRequest): Promise<string> {
    const value = this.env[environmentKeyForSecretReference(request.reference)];
    if (value === undefined) {
      throw new RuntimeSecretResolutionError(
        `Secret unavailable or unauthorized: ${redactSecretReference(request.reference)}`,
        request
      );
    }
    return value;
  }
}

export async function resolveSecretEnv(input: {
  secretEnv?: Record<string, RuntimeSecretReference>;
  resolver: RuntimeSecretResolver;
  runtimeId: string;
  sessionId: string;
  jobId?: string;
  serverId?: string;
}): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [name, reference] of Object.entries(input.secretEnv ?? {})) {
    resolved[name] = await input.resolver.resolve({
      reference,
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      jobId: input.jobId,
      serverId: input.serverId,
    });
  }
  return resolved;
}
