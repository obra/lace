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
  constructor(
    message: string,
    public readonly reference: RuntimeSecretReference
  ) {
    super(message);
    this.name = 'RuntimeSecretResolutionError';
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
        request.reference
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
