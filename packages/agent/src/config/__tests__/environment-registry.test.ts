// ABOUTME: Tests for the environment registry — loads /etc/sen-environments defs
// ABOUTME: Real temp-dir markdown files, never mocked fs

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EnvironmentRegistry,
  EnvironmentNotFoundError,
  EnvironmentParseError,
} from '../environment-registry';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-reg-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeEnv(name: string, body: string): void {
  fs.writeFileSync(path.join(dir, `${name}.md`), body);
}

const PERSISTENT_BOX = `---
runtime:
  type: container
  containerSharing: persistent
  image: sen-persistent-box:dev
  workingDirectory: /home/sen
  mounts:
    - home
    - scratch
    - knowledge
---

# ignored body
`;

describe('EnvironmentRegistry', () => {
  it('parses a persistent environment def', () => {
    writeEnv('persistent-box', PERSISTENT_BOX);
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    const env = reg.parseEnvironment('persistent-box');
    expect(env.runtime.containerSharing).toBe('persistent');
    expect(env.runtime.image).toBe('sen-persistent-box:dev');
    expect(env.runtime.mounts).toEqual(['home', 'scratch', 'knowledge']);
  });

  it('throws EnvironmentNotFoundError for a missing env', () => {
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('nope')).toThrow(EnvironmentNotFoundError);
  });

  it('throws EnvironmentParseError on a root runtime (envs are containers only)', () => {
    writeEnv('bad', `---\nruntime:\n  type: root\n---\n`);
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('bad')).toThrow(EnvironmentParseError);
  });

  // The container-spec field validation (image/mounts/caps/sysctls/ports/...)
  // moved here from the persona schema under Part A — the box is an environment
  // property now. These mirror the inline-container persona tests that used to
  // live in persona-registry.test.ts.

  it('parses a per_invocation environment with ports + env', () => {
    writeEnv(
      'with-ports',
      `---
runtime:
  type: container
  containerSharing: per_invocation
  image: ghcr.io/example/lace-shell:latest
  workingDirectory: /workspace
  mounts:
    - scratch
    - knowledge
  env:
    FOO: bar
  ports:
    - host: 8080
      container: 80
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(reg.parseEnvironment('with-ports').runtime).toEqual({
      type: 'container',
      containerSharing: 'per_invocation',
      image: 'ghcr.io/example/lace-shell:latest',
      workingDirectory: '/workspace',
      mounts: ['scratch', 'knowledge'],
      env: { FOO: 'bar' },
      ports: [{ host: 8080, container: 80 }],
    });
  });

  it('defaults env to {} and accepts empty mounts', () => {
    writeEnv(
      'minimal',
      `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
  mounts: []
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(reg.parseEnvironment('minimal').runtime).toEqual({
      type: 'container',
      containerSharing: 'per_invocation',
      image: 'img:latest',
      workingDirectory: '/w',
      mounts: [],
      env: {},
    });
  });

  it('rejects ports outside u16 bounds', () => {
    const cases = [
      { name: 'host-low', host: -1, container: 80 },
      { name: 'host-high', host: 65536, container: 80 },
      { name: 'container-low', host: 8080, container: -1 },
      { name: 'container-high', host: 8080, container: 65536 },
    ];
    for (const { name, host, container } of cases) {
      writeEnv(
        name,
        `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /work
  mounts: []
  ports:
    - host: ${host}
      container: ${container}
---
Body.`
      );
      const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
      expect(() => reg.parseEnvironment(name)).toThrow(EnvironmentParseError);
    }
  });

  it('accepts sysctls, capAdd, network, gatewayRoute, browserCdpSocket', () => {
    writeEnv(
      'full',
      `---
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-browser:dev
  workingDirectory: /work
  mounts: []
  sysctls:
    net.ipv6.conf.lo.disable_ipv6: "0"
  capAdd:
    - NET_ADMIN
  network: quarantine
  gatewayRoute: "172.31.250.1"
  browserCdpSocket: true
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(reg.parseEnvironment('full').runtime).toMatchObject({
      type: 'container',
      sysctls: { 'net.ipv6.conf.lo.disable_ipv6': '0' },
      capAdd: ['NET_ADMIN'],
      network: 'quarantine',
      gatewayRoute: '172.31.250.1',
      browserCdpSocket: true,
    });
  });

  it('rejects a missing image', () => {
    writeEnv(
      'no-image',
      `---
runtime:
  type: container
  containerSharing: per_invocation
  workingDirectory: /w
  mounts: []
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('no-image')).toThrow(/image/i);
  });

  it('rejects a missing mounts array', () => {
    writeEnv(
      'no-mounts',
      `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('no-mounts')).toThrow(/mounts/i);
  });

  it('rejects invalid mount names (uppercase / leading digit)', () => {
    writeEnv(
      'bad-mount-upper',
      `---
runtime:
  type: container
  containerSharing: per_invocation
  image: img:latest
  workingDirectory: /w
  mounts:
    - Scratch
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('bad-mount-upper')).toThrow(/mounts/i);
  });

  it('rejects a persistent environment that declares ports', () => {
    writeEnv(
      'persistent-ports',
      `---
runtime:
  type: container
  containerSharing: persistent
  image: img:latest
  workingDirectory: /home/agent
  mounts: []
  ports:
    - host: 8080
      container: 80
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('persistent-ports')).toThrow(/ports/i);
  });

  it('rejects the old containerLifecycle field name', () => {
    writeEnv(
      'old-lifecycle',
      `---
runtime:
  type: container
  containerLifecycle: session
  image: node:24-bookworm
  workingDirectory: /work
  mounts: []
---
Body.`
    );
    const reg = new EnvironmentRegistry({ environmentsPaths: [dir] });
    expect(() => reg.parseEnvironment('old-lifecycle')).toThrow(/containerLifecycle/);
  });
});
