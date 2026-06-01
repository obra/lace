// ABOUTME: Tests for the spawn-broker boot factory — builds the server from boot env.
// ABOUTME: Asserts required env is present (fail loud) and optional env is honored.

import { describe, it, expect } from 'vitest';
import { buildBrokerFromEnv, REQUIRED_BROKER_ENV } from '../spawn-broker-entrypoint';
import { SpawnBrokerServer } from '../spawn-broker-server';

const FULL_ENV = {
  SEN_SPAWN_BROKER_SOCKET: '/run/sen/spawn-broker.sock',
  SEN_INSTANCE_HOST_PATH: '/mnt/data/ada-sen',
  SEN_CREDENTIAL_HELPER_SOCKET_HOST_PATH: '/mnt/data/ada-sen/state/sockets/sen-cred.sock',
  SEN_PERSONA_DIR: '/mnt/data/ada-sen/user/agent-personas',
  SEN_BROKER_WORK_BASE_HOST_PATH: '/mnt/data/ada-sen/work',
};

describe('buildBrokerFromEnv', () => {
  it('builds a SpawnBrokerServer from a full boot env', () => {
    const server = buildBrokerFromEnv(FULL_ENV);
    expect(server).toBeInstanceOf(SpawnBrokerServer);
  });

  it.each(REQUIRED_BROKER_ENV)('throws clearly when %s is missing', (key) => {
    const env: Record<string, string | undefined> = { ...FULL_ENV };
    delete env[key];
    expect(() => buildBrokerFromEnv(env)).toThrow(new RegExp(key));
  });

  it('throws when a required var is present but empty', () => {
    expect(() => buildBrokerFromEnv({ ...FULL_ENV, SEN_SPAWN_BROKER_SOCKET: '' })).toThrow(
      /SEN_SPAWN_BROKER_SOCKET/
    );
  });

  it('accepts optional CA-store + browser-cdp host paths without error', () => {
    const server = buildBrokerFromEnv({
      ...FULL_ENV,
      SEN_CREDENTIAL_HELPER_CA_STORE_HOST_PATH: '/mnt/data/ada-sen/state/credential-helper',
      SEN_BROWSER_CDP_HOST_PATH: '/mnt/data/ada-sen/state/browser-cdp',
    });
    expect(server).toBeInstanceOf(SpawnBrokerServer);
  });
});
