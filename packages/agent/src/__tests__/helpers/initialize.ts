export type InitializeOverrides = {
  capabilities?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type InitializeExtras = {
  userPersonasPaths?: string[];
  containerMounts?: Record<string, { hostPath: string; readonly: boolean }>;
};

export function defaultInitializeParams(
  overrides: InitializeOverrides = {},
  extras: InitializeExtras = {}
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
    ...(extras.userPersonasPaths ? { userPersonasPaths: extras.userPersonasPaths } : {}),
    ...(extras.containerMounts !== undefined ? { containerMounts: extras.containerMounts } : {}),
  };
}
