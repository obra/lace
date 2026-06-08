// ABOUTME: Tests that a subagent child's initialize params carry the parent's credential tool dir
// (top-level credentialToolsPaths) and the parent's broker socket (child config.credentialBrokerSocket),
// so a box-worker child can both register request_credential and reach the broker (Part B C2).

import { describe, it, expect } from 'vitest';
import {
  buildSubagentInitConfig,
  buildSubagentCredentialInitParams,
} from '../subagent-job-helpers';

describe('buildSubagentInitConfig — credential broker socket', () => {
  it('forwards the parent broker socket into the child config', () => {
    expect(
      buildSubagentInitConfig({
        approvalMode: 'approve',
        credentialBrokerSocket: '/s',
      })
    ).toEqual({ approvalMode: 'approve', credentialBrokerSocket: '/s' });
  });

  it('omits credentialBrokerSocket when the parent has none', () => {
    expect(buildSubagentInitConfig({ approvalMode: 'approve' })).toEqual({
      approvalMode: 'approve',
    });
  });
});

describe('buildSubagentCredentialInitParams — top-level credential tool dir', () => {
  it('forwards the parent credentialToolsPaths as a top-level init param', () => {
    expect(buildSubagentCredentialInitParams({ credentialToolsPaths: ['/x'] })).toEqual({
      credentialToolsPaths: ['/x'],
    });
  });

  it('omits credentialToolsPaths when the parent has none', () => {
    expect(buildSubagentCredentialInitParams({})).toEqual({});
  });

  it('omits credentialToolsPaths when the parent has an empty list', () => {
    expect(buildSubagentCredentialInitParams({ credentialToolsPaths: [] })).toEqual({});
  });
});
