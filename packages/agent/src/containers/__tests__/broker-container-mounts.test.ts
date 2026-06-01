// ABOUTME: Tests for the broker-side container mount registry builder
// ABOUTME: Asserts the broker reproduces sen-core's buildContainerMounts host-path layout exactly

import { describe, it, expect } from 'vitest';
import { buildBrokerContainerMounts } from '../broker-container-mounts';

const ROOT = '/mnt/data/ada-sen';

describe('buildBrokerContainerMounts', () => {
  it('builds the four base mounts from the instance host root', () => {
    const mounts = buildBrokerContainerMounts({ instanceHostPath: ROOT });
    expect(mounts).toEqual({
      scratch: { hostPath: '/mnt/data/ada-sen/state/scratch', readonly: false },
      knowledge: { hostPath: '/mnt/data/ada-sen/user/knowledge', readonly: true },
      identity: { hostPath: '/mnt/data/ada-sen/user/identity', readonly: true },
      home: { hostPath: '/mnt/data/ada-sen/user/home', readonly: false },
    });
  });

  it('adds sen-cred / sen-ca / sen-browser-cdp when a credential socket host path is present', () => {
    const mounts = buildBrokerContainerMounts({
      instanceHostPath: ROOT,
      credentialHelperSocketHostPath: '/mnt/data/ada-sen/state/sockets/sen-cred.sock',
    });
    // A3b: sen-cred source is the socket's directory (post-relocation = state/sockets/).
    expect(mounts['sen-cred']).toEqual({
      hostPath: '/mnt/data/ada-sen/state/sockets',
      readonly: true,
    });
    // sen-ca + sen-browser-cdp fall back to the instance-root layout when no
    // explicit host path is supplied.
    expect(mounts['sen-ca']).toEqual({
      hostPath: '/mnt/data/ada-sen/state/credential-helper',
      readonly: true,
    });
    expect(mounts['sen-browser-cdp']).toEqual({
      hostPath: '/mnt/data/ada-sen/state/browser-cdp',
      readonly: false,
    });
  });

  it('honors explicit CA-store and browser-cdp host paths', () => {
    const mounts = buildBrokerContainerMounts({
      instanceHostPath: ROOT,
      credentialHelperSocketHostPath: '/run/sen-cred.sock',
      credentialCaStoreHostPath: '/custom/ca',
      browserCdpHostPath: '/custom/cdp',
    });
    expect(mounts['sen-ca'].hostPath).toBe('/custom/ca');
    expect(mounts['sen-browser-cdp'].hostPath).toBe('/custom/cdp');
    expect(mounts['sen-cred'].hostPath).toBe('/run');
  });

  it('omits the credential mounts entirely when no socket host path is present', () => {
    const mounts = buildBrokerContainerMounts({ instanceHostPath: ROOT });
    expect(mounts['sen-cred']).toBeUndefined();
    expect(mounts['sen-ca']).toBeUndefined();
    expect(mounts['sen-browser-cdp']).toBeUndefined();
  });
});
