// ABOUTME: Tests for BrokerPersonaCatalog — broker-side assembly of full persona ContainerConfigs
// ABOUTME: Exercises the real persona-file parser on real sen-core persona frontmatter (real fs, no mocks)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrokerPersonaCatalog } from '../spawn-broker-personas';
import type { PersonaSpawnContext } from '../spawn-broker-personas';
import type { ContainerConfig, ContainerMount } from '../types';

// Self-contained persona fixtures mirroring the sen-core container personas'
// `runtime:` frontmatter (the broker reads these at runtime from a RO-mounted
// dir). Inlined — not read from sen-core — so this lace test is portable (no
// cross-repo path) and matches lace's fixture idiom (config/persona-registry.test.ts
// writes persona .md files into a tempdir). Drift between these fixtures and the
// real persona files is caught by the on-box parity smoke (PRI-2012 Task 9), not
// by this unit test, whose job is the assembly logic.
const PERSONA_FIXTURES: Record<string, string> = {
  'browser-driver': `---
model: claude-sonnet-4-6
tools:
  - bash
  - superpowers-chrome/use_browser
  - use_skill
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-browser:dev
  workingDirectory: /work
  mounts:
    knowledge: /knowledge
    identity: /sen/identity
    sen-cred: /run
    sen-ca: /etc/sen-credential-proxy-ca
    sen-browser-cdp: /sen-browser-cdp
  env:
    DISPLAY: ":1"
    NODE_EXTRA_CA_CERTS: /etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem
    SSL_CERT_FILE: /etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem
  ports:
    - host: 6080
      container: 6080
  sysctls:
    net.ipv6.conf.lo.disable_ipv6: "0"
    net.ipv6.conf.all.disable_ipv6: "1"
  network: quarantine
  gatewayRoute: 172.31.250.2
  browserCdpSocket: true
maxTurns: 100
---
browser-driver fixture body.
`,
  'persistent-box': `---
model: claude-sonnet-4-6
tools:
  - bash
runtime:
  type: container
  containerSharing: persistent
  image: sen-persistent-box:dev
  workingDirectory: /home/sen
  mounts:
    home: /home/sen
    scratch: /work
    knowledge: /knowledge
    identity: /sen/identity
    sen-cred: /run
    sen-ca: /etc/sen-credential-proxy-ca
  network: quarantine
  gatewayRoute: 172.31.250.2
  sysctls:
    net.ipv6.conf.all.disable_ipv6: "1"
  env:
    HOME: /home/sen
    NODE_EXTRA_CA_CERTS: /etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem
    SSL_CERT_FILE: /etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem
maxTurns: 100
---
persistent-box fixture body.
`,
  'ephemeral-shell': `---
model: claude-sonnet-4-6
tools:
  - bash
runtime:
  type: container
  containerSharing: per_invocation
  image: sen-ephemeral-shell:dev
  workingDirectory: /work
  mounts:
    knowledge: /knowledge
    identity: /sen/identity
    sen-cred: /run
    sen-ca: /etc/sen-credential-proxy-ca
  network: quarantine
  gatewayRoute: 172.31.250.2
  sysctls:
    net.ipv6.conf.all.disable_ipv6: "1"
  env:
    NODE_EXTRA_CA_CERTS: /etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem
    SSL_CERT_FILE: /etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem
maxTurns: 100
---
ephemeral-shell fixture body.
`,
};

const INSTANCE_HOST_PATH = '/mnt/data/ada-sen';
const CRED_SOCKET = '/mnt/data/ada-sen/state/sockets/sen-cred.sock';

const CTX: PersonaSpawnContext = {
  parentSessionId: 'sess_aabbccddeeff00112233445566778899',
  childSessionId: 'sess_99887766554433221100ffeeddccbbaa',
  jobId: 'job_1234',
  agentToken: 'tok-supersecret-abc123',
};

let tmpRoot: string;
let personasDir: string;
let workBase: string;
let catalog: BrokerPersonaCatalog;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-personas-'));
  personasDir = path.join(tmpRoot, 'agent-personas');
  workBase = path.join(tmpRoot, 'work');
  fs.mkdirSync(personasDir, { recursive: true });
  fs.mkdirSync(workBase, { recursive: true });

  for (const [name, content] of Object.entries(PERSONA_FIXTURES)) {
    fs.writeFileSync(path.join(personasDir, `${name}.md`), content);
  }

  catalog = new BrokerPersonaCatalog({
    personasDir,
    workBaseHostPath: workBase,
    mountEnv: {
      instanceHostPath: INSTANCE_HOST_PATH,
      credentialHelperSocketHostPath: CRED_SOCKET,
    },
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Helper: find a mount by container target in a built config.
function mountFor(config: ContainerConfig, target: string): ContainerMount | undefined {
  return config.mounts.find((m) => m.target === target);
}

describe('BrokerPersonaCatalog.buildContainerConfig', () => {
  describe('browser-driver (sen-browser:dev, per_invocation)', () => {
    let config: ContainerConfig;
    let name: string;
    beforeAll(() => {
      config = catalog.buildContainerConfig('browser-driver', CTX);
      // <parent8>-browser-driver-<child8>; sess_ prefix stripped before first 8 hex.
      name = 'aabbccdd-browser-driver-99887766';
    });

    it('uses the sen-browser:dev image and /work workdir', () => {
      expect(config.image).toBe('sen-browser:dev');
      expect(config.workingDirectory).toBe('/work');
    });

    it('derives the per-invocation name and lace- prefixed id', () => {
      expect(config.name).toBe(name);
      expect(config.id).toBe(`lace-${name}`);
    });

    it('joins the quarantine network with the gateway route', () => {
      expect(config.network).toBe('quarantine');
      expect(config.gatewayRoute).toBe('172.31.250.2');
    });

    it('sets both IPv6 sysctls and adds no capabilities', () => {
      expect(config.sysctls).toEqual({
        'net.ipv6.conf.lo.disable_ipv6': '0',
        'net.ipv6.conf.all.disable_ipv6': '1',
      });
      expect(config.capAdd).toBeUndefined();
    });

    it('publishes the noVNC port 6080 (browser-driver only)', () => {
      expect(config.ports).toEqual([{ host: 6080, container: 6080 }]);
    });

    it('does not set a restart policy or a command', () => {
      expect(config.restartPolicy).toBeUndefined();
      expect(config.command).toBeUndefined();
    });

    it('resolves all persona mounts to instance host paths', () => {
      expect(mountFor(config, '/work')).toEqual({
        source: path.join(workBase, CTX.childSessionId),
        target: '/work',
        readonly: false,
      });
      expect(mountFor(config, '/knowledge')).toEqual({
        source: '/mnt/data/ada-sen/user/knowledge',
        target: '/knowledge',
        readonly: true,
      });
      expect(mountFor(config, '/sen/identity')).toEqual({
        source: '/mnt/data/ada-sen/user/identity',
        target: '/sen/identity',
        readonly: true,
      });
      // sen-cred → /run, source = dirname of the helper socket.
      expect(mountFor(config, '/run')).toEqual({
        source: '/mnt/data/ada-sen/state/sockets',
        target: '/run',
        readonly: true,
      });
      // sen-ca → CA-store dir.
      expect(mountFor(config, '/etc/sen-credential-proxy-ca')).toEqual({
        source: '/mnt/data/ada-sen/state/credential-helper',
        target: '/etc/sen-credential-proxy-ca',
        readonly: true,
      });
      // sen-browser-cdp → shared CDP socket dir (rw); only browser-driver.
      expect(mountFor(config, '/sen-browser-cdp')).toEqual({
        source: '/mnt/data/ada-sen/state/browser-cdp',
        target: '/sen-browser-cdp',
        readonly: false,
      });
    });

    it('injects the per-spawn browser CDP socket env keyed on the container name', () => {
      expect(config.environment?.SEN_BROWSER_CDP_SOCKET).toBe(`/sen-browser-cdp/${name}.sock`);
    });

    it('carries the static persona env (DISPLAY + CA pem paths)', () => {
      expect(config.environment?.DISPLAY).toBe(':1');
      expect(config.environment?.NODE_EXTRA_CA_CERTS).toBe(
        '/etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem'
      );
      expect(config.environment?.SSL_CERT_FILE).toBe(
        '/etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem'
      );
    });

    it('stamps the broker-minted agent token under SEN_AGENT_TOKEN', () => {
      expect(config.environment?.SEN_AGENT_TOKEN).toBe(CTX.agentToken);
    });

    it('creates the per-invocation scratch dir under the work base', () => {
      const scratch = path.join(workBase, CTX.childSessionId);
      expect(fs.existsSync(scratch)).toBe(true);
      expect(fs.statSync(scratch).isDirectory()).toBe(true);
    });
  });

  describe('persistent-box (sen-persistent-box:dev, persistent)', () => {
    let config: ContainerConfig;
    beforeAll(() => {
      config = catalog.buildContainerConfig('persistent-box', CTX);
    });

    it('uses the sen-persistent-box:dev image and /home/sen workdir', () => {
      expect(config.image).toBe('sen-persistent-box:dev');
      expect(config.workingDirectory).toBe('/home/sen');
    });

    it('uses the stable name and id sen-persistent-box', () => {
      expect(config.name).toBe('persistent-box');
      expect(config.id).toBe('sen-persistent-box');
    });

    it('sets restartPolicy unless-stopped (only persistent-box)', () => {
      expect(config.restartPolicy).toBe('unless-stopped');
      expect(config.command).toBeUndefined();
    });

    it('joins the quarantine network with the gateway route, no capAdd', () => {
      expect(config.network).toBe('quarantine');
      expect(config.gatewayRoute).toBe('172.31.250.2');
      expect(config.capAdd).toBeUndefined();
    });

    it('sets only the all-interfaces IPv6 sysctl and publishes no ports', () => {
      expect(config.sysctls).toEqual({ 'net.ipv6.conf.all.disable_ipv6': '1' });
      expect(config.ports).toBeUndefined();
    });

    it('mounts home rw and declares scratch at /work (no lace auto-inject, no cdp)', () => {
      expect(mountFor(config, '/home/sen')).toEqual({
        source: '/mnt/data/ada-sen/user/home',
        target: '/home/sen',
        readonly: false,
      });
      expect(mountFor(config, '/work')).toEqual({
        source: '/mnt/data/ada-sen/state/scratch',
        target: '/work',
        readonly: false,
      });
      expect(mountFor(config, '/sen-browser-cdp')).toBeUndefined();
    });

    it('carries HOME + CA pem env, the agent token, and no CDP socket env', () => {
      expect(config.environment?.HOME).toBe('/home/sen');
      expect(config.environment?.NODE_EXTRA_CA_CERTS).toBe(
        '/etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem'
      );
      expect(config.environment?.SEN_AGENT_TOKEN).toBe(CTX.agentToken);
      expect(config.environment?.SEN_BROWSER_CDP_SOCKET).toBeUndefined();
    });
  });

  describe('ephemeral-shell (sen-ephemeral-shell:dev, per_invocation)', () => {
    let config: ContainerConfig;
    let name: string;
    beforeAll(() => {
      config = catalog.buildContainerConfig('ephemeral-shell', CTX);
      name = 'aabbccdd-ephemeral-shell-99887766';
    });

    it('uses the sen-ephemeral-shell:dev image and /work workdir', () => {
      expect(config.image).toBe('sen-ephemeral-shell:dev');
      expect(config.workingDirectory).toBe('/work');
    });

    it('derives the per-invocation name and lace- prefixed id', () => {
      expect(config.name).toBe(name);
      expect(config.id).toBe(`lace-${name}`);
    });

    it('sets only the all-interfaces IPv6 sysctl, no ports, no restart, no command', () => {
      expect(config.sysctls).toEqual({ 'net.ipv6.conf.all.disable_ipv6': '1' });
      expect(config.ports).toBeUndefined();
      expect(config.restartPolicy).toBeUndefined();
      expect(config.command).toBeUndefined();
      expect(config.capAdd).toBeUndefined();
    });

    it('joins the quarantine network with the gateway route', () => {
      expect(config.network).toBe('quarantine');
      expect(config.gatewayRoute).toBe('172.31.250.2');
    });

    it('auto-injects /work scratch and mounts knowledge/identity/cred/ca, no cdp', () => {
      expect(mountFor(config, '/work')).toEqual({
        source: path.join(workBase, CTX.childSessionId),
        target: '/work',
        readonly: false,
      });
      expect(mountFor(config, '/knowledge')?.readonly).toBe(true);
      expect(mountFor(config, '/sen/identity')?.readonly).toBe(true);
      expect(mountFor(config, '/run')?.source).toBe('/mnt/data/ada-sen/state/sockets');
      expect(mountFor(config, '/etc/sen-credential-proxy-ca')).toBeDefined();
      expect(mountFor(config, '/sen-browser-cdp')).toBeUndefined();
    });

    it('carries only CA pem env (no DISPLAY/HOME/CDP) plus the agent token', () => {
      expect(config.environment?.DISPLAY).toBeUndefined();
      expect(config.environment?.HOME).toBeUndefined();
      expect(config.environment?.SEN_BROWSER_CDP_SOCKET).toBeUndefined();
      expect(config.environment?.NODE_EXTRA_CA_CERTS).toBe(
        '/etc/sen-credential-proxy-ca/sen-credential-proxy-ca.pem'
      );
      expect(config.environment?.SEN_AGENT_TOKEN).toBe(CTX.agentToken);
    });
  });

  it('re-validates childSessionId path-safety (defense-in-depth at the trust boundary)', () => {
    for (const bad of ['../escape', 'a/b', 'a.b', 'has space', 'x'.repeat(65)]) {
      expect(() =>
        catalog.buildContainerConfig('ephemeral-shell', { ...CTX, childSessionId: bad })
      ).toThrow(/childSessionId/i);
    }
  });

  it('throws on an unknown persona', () => {
    // Cast through unknown: the catalog must defend at runtime even if a caller
    // smuggles a non-PersonaName past the type system.
    expect(() =>
      catalog.buildContainerConfig('librarian' as unknown as 'browser-driver', CTX)
    ).toThrow();
  });

  it('throws on a non-container (root) persona', () => {
    const rootPersonasDir = path.join(tmpRoot, 'root-personas');
    fs.mkdirSync(rootPersonasDir, { recursive: true });
    fs.writeFileSync(
      path.join(rootPersonasDir, 'root-ish.md'),
      '---\nruntime:\n  type: root\n---\nbody\n'
    );
    const rootCatalog = new BrokerPersonaCatalog({
      personasDir: rootPersonasDir,
      workBaseHostPath: workBase,
      mountEnv: {
        instanceHostPath: INSTANCE_HOST_PATH,
        credentialHelperSocketHostPath: CRED_SOCKET,
      },
    });
    expect(() =>
      rootCatalog.buildContainerConfig('root-ish' as unknown as 'browser-driver', CTX)
    ).toThrow(/container/i);
  });
});
