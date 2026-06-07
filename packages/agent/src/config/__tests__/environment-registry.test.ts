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
});
