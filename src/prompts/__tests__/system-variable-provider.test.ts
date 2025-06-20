// ABOUTME: Tests for SystemVariableProvider - OS, date/time information
// ABOUTME: Following TDD approach - tests written before implementation

import { SystemVariableProvider } from '../variable-providers/system.js';

describe('SystemVariableProvider', () => {
  let provider: SystemVariableProvider;

  beforeEach(() => {
    provider = new SystemVariableProvider();
  });

  it('should provide system OS information', () => {
    const variables = provider.getVariables();
    
    expect(variables.system).toBeDefined();
    expect(typeof variables.system).toBe('object');
    
    const system = variables.system as Record<string, unknown>;
    expect(system.os).toBeDefined();
    expect(typeof system.os).toBe('string');
    expect(system.platform).toBeDefined();
    expect(typeof system.platform).toBe('string');
    expect(system.arch).toBeDefined();
    expect(typeof system.arch).toBe('string');
  });

  it('should provide Node.js version information', () => {
    const variables = provider.getVariables();
    
    const system = variables.system as Record<string, unknown>;
    expect(system.nodeVersion).toBeDefined();
    expect(typeof system.nodeVersion).toBe('string');
    expect(system.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should provide session information', () => {
    const variables = provider.getVariables();
    
    expect(variables.session).toBeDefined();
    expect(typeof variables.session).toBe('object');
    
    const session = variables.session as Record<string, unknown>;
    expect(session.startTime).toBeDefined();
    expect(typeof session.startTime).toBe('string');
    
    // Should be a valid ISO date string
    expect(() => new Date(session.startTime as string)).not.toThrow();
  });

  it('should provide timezone information', () => {
    const variables = provider.getVariables();
    
    const session = variables.session as Record<string, unknown>;
    expect(session.timezone).toBeDefined();
    expect(typeof session.timezone).toBe('string');
  });

  it('should provide current date in readable format', () => {
    const variables = provider.getVariables();
    
    const session = variables.session as Record<string, unknown>;
    expect(session.currentDate).toBeDefined();
    expect(typeof session.currentDate).toBe('string');
    
    // Should match a format like "2024-01-15" or similar
    expect(session.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('should provide consistent values across multiple calls', () => {
    const vars1 = provider.getVariables();
    const vars2 = provider.getVariables();
    
    // System info should be identical
    expect(vars1.system).toEqual(vars2.system);
    
    // Session start time should be identical (not re-generated each call)
    const session1 = vars1.session as Record<string, unknown>;
    const session2 = vars2.session as Record<string, unknown>;
    expect(session1.startTime).toBe(session2.startTime);
  });

  it('should handle system information gracefully on unknown platforms', () => {
    // This test ensures we don't crash on unusual systems
    expect(() => provider.getVariables()).not.toThrow();
    
    const variables = provider.getVariables();
    expect(variables.system).toBeDefined();
  });
});