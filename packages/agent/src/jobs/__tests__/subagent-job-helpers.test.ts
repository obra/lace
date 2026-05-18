// ABOUTME: Tests for subagent-job helpers (config inheritance + error extraction)

import { describe, it, expect } from 'vitest';
import {
  applyEffectiveJobConfig,
  buildSubagentInitConfig,
  rpcErrorMessage,
} from '../subagent-job-helpers';

describe('applyEffectiveJobConfig', () => {
  it('fills both fields when both are unset on the job', () => {
    const job: { connectionId?: string; modelId?: string } = {};
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'parent-conn', modelId: 'parent-model' });
  });

  it('inherits connectionId when only modelId was set (persona-supplied model case)', () => {
    const job: { connectionId?: string; modelId?: string } = { modelId: 'persona-model' };
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'parent-conn', modelId: 'persona-model' });
  });

  it('inherits modelId when only connectionId was set', () => {
    const job: { connectionId?: string; modelId?: string } = { connectionId: 'explicit-conn' };
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'explicit-conn', modelId: 'parent-model' });
  });

  it('does not overwrite either field when both are already set', () => {
    const job: { connectionId?: string; modelId?: string } = {
      connectionId: 'explicit-conn',
      modelId: 'explicit-model',
    };
    applyEffectiveJobConfig(job, { connectionId: 'parent-conn', modelId: 'parent-model' });
    expect(job).toEqual({ connectionId: 'explicit-conn', modelId: 'explicit-model' });
  });

  it('leaves a field undefined when the effective config also has it undefined', () => {
    const job: { connectionId?: string; modelId?: string } = { modelId: 'persona-model' };
    applyEffectiveJobConfig(job, { modelId: 'parent-model' });
    expect(job.connectionId).toBeUndefined();
    expect(job.modelId).toBe('persona-model');
  });
});

describe('buildSubagentInitConfig (kata #37 Layer A)', () => {
  // The bug: subagent-job.ts:569 used to hardcode `config: { approvalMode: 'ask' }`
  // on `initialize`, regardless of the parent's approvalMode. That meant a parent
  // running with `dangerouslySkipPermissions` (e.g. an automated runner that never
  // attaches a permission handler) would spawn children that still tried to ask
  // for permission — and the request would be cancelled within ~15ms by the
  // sen-core supervisor's missing handler, silently dropping the subagent's
  // tool calls. The fix propagates the parent's effective approvalMode.

  it('propagates dangerouslySkipPermissions from the parent effective config', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'dangerouslySkipPermissions' })).toEqual({
      approvalMode: 'dangerouslySkipPermissions',
    });
  });

  it('propagates ask from the parent effective config (negative: not always skip)', () => {
    // Parent's mode propagates verbatim — children do not get a hardcoded
    // permission-bypass when the parent is genuinely in ask mode.
    expect(buildSubagentInitConfig({ approvalMode: 'ask' })).toEqual({
      approvalMode: 'ask',
    });
  });

  it('propagates approve from the parent effective config', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'approve' })).toEqual({
      approvalMode: 'approve',
    });
  });

  it('propagates deny from the parent effective config', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'deny' })).toEqual({
      approvalMode: 'deny',
    });
  });

  it("defaults to 'ask' when the parent effective config has no approvalMode set", () => {
    // Safe fallback: an unconfigured parent must not silently grant child
    // sessions a permission bypass.
    expect(buildSubagentInitConfig({})).toEqual({ approvalMode: 'ask' });
  });
});

describe('rpcErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(rpcErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('extracts message from a JSON-RPC error response object (the kata #29 case)', () => {
    const wireError = {
      code: -32602,
      message: 'connectionId and modelId are required before prompting',
      data: { category: 'protocol' },
    };
    expect(rpcErrorMessage(wireError)).toBe(
      'connectionId and modelId are required before prompting'
    );
  });

  it('extracts message from a plain object that has a string message field', () => {
    expect(rpcErrorMessage({ message: 'hello' })).toBe('hello');
  });

  it('falls back to String() when message is not a string', () => {
    expect(rpcErrorMessage({ message: { nested: true } })).toBe('[object Object]');
  });

  it('falls back to String() when value has no message field', () => {
    expect(rpcErrorMessage('plain string')).toBe('plain string');
    expect(rpcErrorMessage(42)).toBe('42');
  });

  it('handles null and undefined', () => {
    expect(rpcErrorMessage(null)).toBe('null');
    expect(rpcErrorMessage(undefined)).toBe('undefined');
  });
});
