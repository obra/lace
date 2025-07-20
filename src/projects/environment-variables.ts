// ABOUTME: Project-level environment variables with encryption and inheritance
// ABOUTME: Secure handling of environment variables with project-specific scoping

export interface EnvironmentOptions {
  encrypt?: string[];
  inheritFrom?: string;
}

export class ProjectEnvironmentManager {
  private environments = new Map<string, Record<string, string>>();
  private encryptedKeys = new Map<string, Set<string>>();
  private inheritanceChain = new Map<string, string>();
  private encryptionKey: string;

  constructor() {
    // In production, this should come from secure key management
    this.encryptionKey = process.env.LACE_ENCRYPTION_KEY || 'default-dev-key-change-in-production';
  }

  setEnvironmentVariables(
    projectId: string,
    variables: Record<string, string>,
    options: EnvironmentOptions = {}
  ): void {
    // Validate variable names
    for (const key of Object.keys(variables)) {
      if (!this.isValidEnvironmentVariableName(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
    }

    // Handle encryption
    const processedVariables = { ...variables };
    const encryptedKeySet = new Set<string>();

    if (options.encrypt) {
      for (const key of options.encrypt) {
        if (key in processedVariables) {
          processedVariables[key] = this.encryptValue(processedVariables[key]);
          encryptedKeySet.add(key);
        }
      }
    }

    // Store variables and encryption metadata
    this.environments.set(projectId, processedVariables);
    this.encryptedKeys.set(projectId, encryptedKeySet);

    // Handle inheritance
    if (options.inheritFrom) {
      this.inheritanceChain.set(projectId, options.inheritFrom);
    }
  }

  getEnvironmentVariables(projectId: string): Record<string, string> {
    const variables = this.getStoredEnvironmentVariables(projectId);
    const encryptedKeys = this.encryptedKeys.get(projectId) || new Set();
    const result: Record<string, string> = {};

    // Decrypt encrypted variables
    for (const [key, value] of Object.entries(variables)) {
      if (encryptedKeys.has(key)) {
        result[key] = this.decryptValue(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  getStoredEnvironmentVariables(projectId: string): Record<string, string> {
    const directVariables = this.environments.get(projectId) || {};

    // Handle inheritance
    const parentProjectId = this.inheritanceChain.get(projectId);
    if (parentProjectId) {
      const parentVariables = this.getStoredEnvironmentVariables(parentProjectId);
      return { ...parentVariables, ...directVariables };
    }

    return directVariables;
  }

  getMergedEnvironment(projectId: string): Record<string, string> {
    const systemEnv = process.env;
    const projectEnv = this.getEnvironmentVariables(projectId);

    // Project environment overrides system environment
    return { ...systemEnv, ...projectEnv } as Record<string, string>;
  }

  deleteEnvironmentVariable(projectId: string, key: string): void {
    const variables = this.environments.get(projectId);
    if (variables) {
      delete variables[key];
      this.environments.set(projectId, variables);
    }

    const encryptedKeys = this.encryptedKeys.get(projectId);
    if (encryptedKeys) {
      encryptedKeys.delete(key);
    }
  }

  clearEnvironmentVariables(projectId: string): void {
    this.environments.delete(projectId);
    this.encryptedKeys.delete(projectId);
    this.inheritanceChain.delete(projectId);
  }

  private isValidEnvironmentVariableName(name: string): boolean {
    // Environment variable names should start with a letter or underscore
    // and contain only letters, numbers, and underscores
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  }

  private encryptValue(value: string): string {
    // Use a simple base64 encoding for testing purposes
    // In production, use proper encryption with a secure key
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    return `encrypted:${encoded}`;
  }

  private decryptValue(encryptedValue: string): string {
    if (!encryptedValue.startsWith('encrypted:')) {
      return encryptedValue;
    }

    const encoded = encryptedValue.substring('encrypted:'.length);
    return Buffer.from(encoded, 'base64').toString('utf8');
  }
}
