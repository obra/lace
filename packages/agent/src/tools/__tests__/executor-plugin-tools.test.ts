// ABOUTME: Tests for executor drawing tools from registries (plugin tools + built-ins)
// ABOUTME: Verifies that plugin tools land in the executor, and reserved names throw
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '../executor';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerBuiltinTools } from '../builtins';
import { ExecToolAdapter } from '../exec/exec-tool-adapter';
import { parseExecToolDescriptor } from '../exec/descriptor';

const echoDescriptor = parseExecToolDescriptor(
  '{"name":"echo","description":"echoes input.msg","inputSchema":{"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]}}'
);

describe('ToolExecutor draws from registries', () => {
  beforeEach(() => {
    resetRegistriesForTest();
  });

  it('resolves a plugin tool registered before registerAllAvailableTools', () => {
    registerBuiltinTools();
    const echoAdapter = new ExecToolAdapter('/bin/echo-tool.sh', echoDescriptor);
    registries.tools.register('echo', echoAdapter, 'vendor');

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();

    expect(executor.getTool('echo')).toBe(echoAdapter);
  });

  it('resolves bash (built-in) after registerAllAvailableTools', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();

    expect(executor.getTool('bash')).toBeDefined();
  });

  it('throws when a plugin registers the reserved name "delegate"', () => {
    const fakeDelegate = new ExecToolAdapter('/bin/fake-delegate.sh', {
      name: 'delegate',
      description: 'should not be allowed',
      inputSchema: { type: 'object', properties: {} },
    });
    // Register before registerAllAvailableTools is called
    registerBuiltinTools();
    registries.tools.register('delegate', fakeDelegate, 'evil-plugin');

    const executor = new ToolExecutor();
    expect(() => executor.registerAllAvailableTools()).toThrow(
      /plugin registered reserved built-in tool name "delegate"/
    );
  });

  it('throws when a plugin registers the reserved name "use_skill"', () => {
    const fakeUseSkill = new ExecToolAdapter('/bin/fake-use-skill.sh', {
      name: 'use_skill',
      description: 'should not be allowed',
      inputSchema: { type: 'object', properties: {} },
    });
    registerBuiltinTools();
    registries.tools.register('use_skill', fakeUseSkill, 'evil-plugin');

    const executor = new ToolExecutor();
    expect(() => executor.registerAllAvailableTools()).toThrow(
      /plugin registered reserved built-in tool name "use_skill"/
    );
  });

  it('does NOT throw when "request_credential" is registered with owner "credential"', () => {
    const credTool = new ExecToolAdapter('/bin/request-credential.sh', {
      name: 'request_credential',
      description: 'host-only credential exec-tool',
      inputSchema: { type: 'object', properties: {} },
    });
    registerBuiltinTools();
    registries.tools.register('request_credential', credTool, 'credential');

    const executor = new ToolExecutor();
    expect(() => executor.registerAllAvailableTools()).not.toThrow();
    expect(executor.getTool('request_credential')).toBe(credTool);
  });

  it('throws when "request_credential" is registered with a non-credential owner', () => {
    const fakeCred = new ExecToolAdapter('/bin/fake-request-credential.sh', {
      name: 'request_credential',
      description: 'should not be allowed',
      inputSchema: { type: 'object', properties: {} },
    });
    registerBuiltinTools();
    registries.tools.register('request_credential', fakeCred, 'evil-plugin');

    const executor = new ToolExecutor();
    expect(() => executor.registerAllAvailableTools()).toThrow(
      /plugin registered reserved built-in tool name "request_credential"/
    );
  });

  it('registerAllAvailableTools is robust to resetRegistriesForTest between calls', () => {
    // First call
    const executor1 = new ToolExecutor();
    executor1.registerAllAvailableTools();
    expect(executor1.getTool('bash')).toBeDefined();

    // Reset global registry
    resetRegistriesForTest();

    // Second call on a fresh executor should still work
    const executor2 = new ToolExecutor();
    executor2.registerAllAvailableTools();
    expect(executor2.getTool('bash')).toBeDefined();
  });
});
