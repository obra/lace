// ABOUTME: Tests for registerBuiltinTools — registers stateless built-ins into the plugin registry
// ABOUTME: Verifies idempotency, correct tool names, and robustness to resetRegistriesForTest
import { describe, it, expect, beforeEach } from 'vitest';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools, PER_SESSION_BUILTIN_NAMES } from './builtins';

describe('registerBuiltinTools', () => {
  beforeEach(() => {
    resetRegistriesForTest();
  });

  it('registers all stateless built-in tools with owner "builtin"', () => {
    registerBuiltinTools();
    expect(registries.tools.has('bash')).toBe(true);
    expect(registries.tools.has('recall')).toBe(true);
    expect(registries.tools.has('file_read')).toBe(true);
    expect(registries.tools.has('file_write')).toBe(true);
    expect(registries.tools.has('file_edit')).toBe(true);
    expect(registries.tools.has('ripgrep_search')).toBe(true);
    expect(registries.tools.has('file_find')).toBe(true);
    expect(registries.tools.has('url_fetch')).toBe(true);
    expect(registries.tools.has('job_output')).toBe(true);
    expect(registries.tools.has('jobs_list')).toBe(true);
    expect(registries.tools.has('job_kill')).toBe(true);
    expect(registries.tools.has('job_notify')).toBe(true);
    expect(registries.tools.has('todo_read')).toBe(true);
    expect(registries.tools.has('todo_write')).toBe(true);
    expect(registries.tools.has('manage_reminders')).toBe(true);
  });

  it('registers all built-ins with owner "builtin"', () => {
    registerBuiltinTools();
    for (const name of registries.tools.names()) {
      expect(registries.tools.owner(name)).toBe('builtin');
    }
  });

  it('does NOT register per-session built-ins (delegate, use_skill)', () => {
    registerBuiltinTools();
    expect(registries.tools.has('delegate')).toBe(false);
    expect(registries.tools.has('use_skill')).toBe(false);
  });

  it('is idempotent — calling twice does not throw', () => {
    registerBuiltinTools();
    expect(() => registerBuiltinTools()).not.toThrow();
    // Still has all tools
    expect(registries.tools.has('bash')).toBe(true);
  });

  it('is robust to resetRegistriesForTest — re-registers after reset', () => {
    registerBuiltinTools();
    expect(registries.tools.has('bash')).toBe(true);
    resetRegistriesForTest();
    expect(registries.tools.has('bash')).toBe(false);
    // Should re-register after reset
    registerBuiltinTools();
    expect(registries.tools.has('bash')).toBe(true);
  });

  it('PER_SESSION_BUILTIN_NAMES contains delegate and use_skill', () => {
    expect(PER_SESSION_BUILTIN_NAMES.has('delegate')).toBe(true);
    expect(PER_SESSION_BUILTIN_NAMES.has('use_skill')).toBe(true);
    expect(PER_SESSION_BUILTIN_NAMES.size).toBe(2);
  });
});
