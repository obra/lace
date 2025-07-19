// ABOUTME: Tests for project-level environment variables with encryption and inheritance
// ABOUTME: Tests variable storage, validation, inheritance, and secure handling

import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';

describe('Project environment variables', () => {
  let envManager: ProjectEnvironmentManager;
  let projectId: string;

  beforeEach(() => {
    envManager = new ProjectEnvironmentManager();
    projectId = 'project1';
  });

  it('should store and retrieve environment variables', () => {
    const envVars = {
      API_KEY: 'test-api-key',
      DEBUG: 'true',
      NODE_ENV: 'development',
    };

    envManager.setEnvironmentVariables(projectId, envVars);
    const retrieved = envManager.getEnvironmentVariables(projectId);

    expect(retrieved).toEqual(envVars);
  });

  it('should merge with system environment variables', () => {
    // Mock system environment
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SYSTEM_VAR: 'system-value',
      OVERRIDE_VAR: 'system-override',
    };

    const projectEnvVars = {
      PROJECT_VAR: 'project-value',
      OVERRIDE_VAR: 'project-override',
    };

    envManager.setEnvironmentVariables(projectId, projectEnvVars);
    const merged = envManager.getMergedEnvironment(projectId);

    expect(merged.SYSTEM_VAR).toBe('system-value');
    expect(merged.PROJECT_VAR).toBe('project-value');
    expect(merged.OVERRIDE_VAR).toBe('project-override'); // Project overrides system

    // Restore original environment
    process.env = originalEnv;
  });

  it('should validate environment variable names', () => {
    expect(() => {
      envManager.setEnvironmentVariables(projectId, {
        '123INVALID': 'value',
      });
    }).toThrow('Invalid environment variable name: 123INVALID');

    expect(() => {
      envManager.setEnvironmentVariables(projectId, {
        VALID_VAR: 'value',
      });
    }).not.toThrow();
  });

  it('should support environment variable encryption', () => {
    const secretValue = 'super-secret-api-key';
    const envVars = {
      API_KEY: secretValue,
    };

    envManager.setEnvironmentVariables(projectId, envVars, { encrypt: ['API_KEY'] });

    // Stored value should be encrypted
    const stored = envManager.getStoredEnvironmentVariables(projectId);
    expect(stored.API_KEY).not.toBe(secretValue);
    expect(stored.API_KEY).toMatch(/^encrypted:/);

    // Retrieved value should be decrypted
    const retrieved = envManager.getEnvironmentVariables(projectId);
    expect(retrieved.API_KEY).toBe(secretValue);
  });

  it('should support environment variable inheritance', () => {
    const parentProjectId = 'parent-project';
    const childProjectId = 'child-project';

    // Set parent environment variables
    envManager.setEnvironmentVariables(parentProjectId, {
      PARENT_VAR: 'parent-value',
      SHARED_VAR: 'parent-shared',
    });

    // Set child environment variables with inheritance
    envManager.setEnvironmentVariables(
      childProjectId,
      {
        CHILD_VAR: 'child-value',
        SHARED_VAR: 'child-shared',
      },
      { inheritFrom: parentProjectId }
    );

    const childEnv = envManager.getEnvironmentVariables(childProjectId);

    expect(childEnv.PARENT_VAR).toBe('parent-value');
    expect(childEnv.CHILD_VAR).toBe('child-value');
    expect(childEnv.SHARED_VAR).toBe('child-shared'); // Child overrides parent
  });

  it('should delete individual environment variables', () => {
    const envVars = {
      VAR1: 'value1',
      VAR2: 'value2',
      VAR3: 'value3',
    };

    envManager.setEnvironmentVariables(projectId, envVars);
    envManager.deleteEnvironmentVariable(projectId, 'VAR2');

    const retrieved = envManager.getEnvironmentVariables(projectId);
    expect(retrieved.VAR1).toBe('value1');
    expect(retrieved.VAR2).toBeUndefined();
    expect(retrieved.VAR3).toBe('value3');
  });

  it('should clear all environment variables for a project', () => {
    const envVars = {
      VAR1: 'value1',
      VAR2: 'value2',
    };

    envManager.setEnvironmentVariables(projectId, envVars);
    envManager.clearEnvironmentVariables(projectId);

    const retrieved = envManager.getEnvironmentVariables(projectId);
    expect(Object.keys(retrieved)).toHaveLength(0);
  });

  it('should handle encrypted variables during deletion', () => {
    const envVars = {
      PLAIN_VAR: 'plain-value',
      SECRET_VAR: 'secret-value',
    };

    envManager.setEnvironmentVariables(projectId, envVars, { encrypt: ['SECRET_VAR'] });

    // Verify encryption worked
    const stored = envManager.getStoredEnvironmentVariables(projectId);
    expect(stored.SECRET_VAR).toMatch(/^encrypted:/);

    // Delete the encrypted variable
    envManager.deleteEnvironmentVariable(projectId, 'SECRET_VAR');

    const retrieved = envManager.getEnvironmentVariables(projectId);
    expect(retrieved.PLAIN_VAR).toBe('plain-value');
    expect(retrieved.SECRET_VAR).toBeUndefined();
  });

  it('should handle inheritance chains', () => {
    const grandparentId = 'grandparent';
    const parentId = 'parent';
    const childId = 'child';

    // Set up inheritance chain
    envManager.setEnvironmentVariables(grandparentId, {
      GRANDPARENT_VAR: 'grandparent-value',
      SHARED_VAR: 'grandparent-shared',
    });

    envManager.setEnvironmentVariables(
      parentId,
      {
        PARENT_VAR: 'parent-value',
        SHARED_VAR: 'parent-shared',
      },
      { inheritFrom: grandparentId }
    );

    envManager.setEnvironmentVariables(
      childId,
      {
        CHILD_VAR: 'child-value',
        SHARED_VAR: 'child-shared',
      },
      { inheritFrom: parentId }
    );

    const childEnv = envManager.getEnvironmentVariables(childId);

    expect(childEnv.GRANDPARENT_VAR).toBe('grandparent-value');
    expect(childEnv.PARENT_VAR).toBe('parent-value');
    expect(childEnv.CHILD_VAR).toBe('child-value');
    expect(childEnv.SHARED_VAR).toBe('child-shared'); // Child overrides all
  });
});
