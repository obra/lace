export type InitializeOverrides = {
  capabilities?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export function defaultInitializeParams(
  overrides: InitializeOverrides = {}
): Record<string, unknown> {
  return {
    protocolVersion: '1.0',
    clientInfo: { name: 'lace-test-client', version: '0.0.0' },
    capabilities: {
      streaming: true,
      permissions: true,
      ...(overrides.capabilities || {}),
    },
    ...(overrides.config ? { config: overrides.config } : {}),
  };
}
