// ABOUTME: docker-gated integration tests for per_invocation/persistent container sharing
// ABOUTME: skipped silently when docker is unavailable; CI doesn't run docker

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { ContainerManager } from '@lace/agent/containers/container-manager';
import { DockerContainerRuntime } from '@lace/agent/containers/docker-container';
import { buildPersonaContainerSpec } from '@lace/agent/jobs/persona-container-spec';
import { PerInvocationReaper } from '@lace/agent/jobs/per-invocation-reaper';
import type { PersonaContainerRuntime } from '@lace/agent/jobs/persona-container-spec';

// ---------------------------------------------------------------------------
// docker availability check (copied from docker-container.integration.test.ts)
// ---------------------------------------------------------------------------

function hasDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function hasImage(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_AVAILABLE = hasDockerAvailable();

// Use node:24-bookworm for per_invocation tests (has sh + bash, readily available).
// For persistent tests, prefer a locally available embedder image if present; fall back to node:24-bookworm.
const TEST_PER_INVOCATION_IMAGE = process.env.LACE_TEST_PER_INVOCATION_IMAGE ?? 'node:24-bookworm';
const TEST_PERSISTENT_IMAGE =
  process.env.LACE_TEST_PERSISTENT_IMAGE ??
  (hasImage('sen-box:dev') ? 'sen-box:dev' : 'node:24-bookworm');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Mint a session-id-shaped string unique to this test run. */
function newSessionId(): string {
  return `sess_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
}

/** Compute the spec name that buildPersonaContainerSpec will use for per_invocation. */
function perInvocationSpecName(
  parentSessionId: string,
  personaName: string,
  childSessionId: string
): string {
  const parentShort = parentSessionId.startsWith('sess_')
    ? parentSessionId.slice(5, 13)
    : parentSessionId.slice(0, 8);
  const childShort = childSessionId.startsWith('sess_')
    ? childSessionId.slice(5, 13)
    : childSessionId.slice(0, 8);
  return `${parentShort}-${personaName}-${childShort}`;
}

/** The docker container name for a per_invocation spec (lace- prefix). */
function perInvocationDockerName(
  parentSessionId: string,
  personaName: string,
  childSessionId: string
): string {
  return `lace-${perInvocationSpecName(parentSessionId, personaName, childSessionId)}`;
}

/**
 * Exec a command inside a named docker container. Returns the ExecResult from
 * the runtime. Expects the container to already be running.
 *
 * NOTE: We exec directly via `docker exec` using execFileSync so we can run
 * commands in containers that the ContainerManager knows about (keyed on
 * docker name). The ContainerManager.exec path requires the container to be in
 * the manager's internal cache. To keep things simple we call docker CLI
 * directly for probe commands.
 */
function dockerExec(
  containerName: string,
  cmd: string[]
): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('docker', ['exec', containerName, ...cmd], {
      encoding: 'utf8',
      timeout: 15000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

/** Check whether a container name appears in `docker ps -a` output. */
function dockerContainerExists(name: string): boolean {
  try {
    const out = execFileSync(
      'docker',
      ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 10000 }
    );
    return out
      .trim()
      .split('\n')
      .some((n) => n.trim() === name);
  } catch {
    return false;
  }
}

/** Force-remove a docker container by name, ignoring errors. */
function forceRemoveContainer(name: string): void {
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 15000 });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// test suite
// ---------------------------------------------------------------------------

describe.skipIf(!DOCKER_AVAILABLE)('persona container sharing integration', () => {
  let runtime: DockerContainerRuntime;
  let containerManager: ContainerManager;

  // Track every docker container name created during tests for cleanup.
  const createdContainerNames: string[] = [];
  // Track every tempdir created during tests for cleanup.
  const createdTempDirs: string[] = [];

  beforeAll(async () => {
    runtime = new DockerContainerRuntime();
    containerManager = new ContainerManager(runtime);

    // Pull images if missing. Timeout generous for first-time pull.
    await pullImageIfMissing(TEST_PER_INVOCATION_IMAGE);
    if (TEST_PERSISTENT_IMAGE !== TEST_PER_INVOCATION_IMAGE) {
      await pullImageIfMissing(TEST_PERSISTENT_IMAGE);
    }
  }, 300_000);

  afterEach(async () => {
    // Force-destroy every tracked container even if the test failed.
    for (const name of createdContainerNames.splice(0)) {
      forceRemoveContainer(name);
    }
    // Remove every temp dir.
    for (const dir of createdTempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // helpers scoped to the suite so they can push to createdContainerNames
  // -------------------------------------------------------------------------

  async function makeScratchDir(): Promise<string> {
    const base = await mkdtemp(join(tmpdir(), 'lace-pri1796-'));
    createdTempDirs.push(base);
    return base;
  }

  async function materializePerInvocation(opts: {
    parentSessionId: string;
    personaName: string;
    childSessionId: string;
    scratchDirHostPath: string;
  }): Promise<{ specName: string; dockerName: string }> {
    const { parentSessionId, personaName, childSessionId, scratchDirHostPath } = opts;

    const perInvocationRuntime: PersonaContainerRuntime = {
      type: 'container',
      containerSharing: 'per_invocation',
      image: TEST_PER_INVOCATION_IMAGE,
      workingDirectory: '/work',
      mounts: [],
      env: {},
    };

    await mkdir(scratchDirHostPath, { recursive: true });

    const spec = buildPersonaContainerSpec({
      parentSessionId,
      personaName,
      runtime: perInvocationRuntime,
      containerMounts: {},
      childSessionId,
      scratchDirHostPath,
    });

    const specName = spec.name;
    const dockerName = `lace-${specName}`;
    createdContainerNames.push(dockerName);

    await containerManager.materialize(spec);

    return { specName, dockerName };
  }

  async function materializePersistent(opts: {
    personaName: string;
  }): Promise<{ specName: string; dockerName: string }> {
    const { personaName } = opts;

    const persistentRuntime: PersonaContainerRuntime = {
      type: 'container',
      containerSharing: 'persistent',
      image: TEST_PERSISTENT_IMAGE,
      workingDirectory: '/tmp',
      mounts: [],
      env: {},
    };

    const spec = buildPersonaContainerSpec({
      parentSessionId: 'sess_parentforpersistent',
      personaName,
      runtime: persistentRuntime,
      containerMounts: {},
    });

    const specName = spec.name;
    // Persistent containers use spec.containerId = `<prefix>-<persona>` (no lace- prefix).
    const dockerName = `box-${personaName}`;
    createdContainerNames.push(dockerName);

    await containerManager.materialize(spec);

    return { specName, dockerName };
  }

  // -------------------------------------------------------------------------
  // Test 1b: concurrent per_invocation containers don't collide
  // -------------------------------------------------------------------------

  it('spawns concurrent per_invocation containers without name collision', async () => {
    const parentId = newSessionId();
    const childIdA = newSessionId();
    const childIdB = newSessionId();
    const personaName = 'test-shell';

    const scratchA = await makeScratchDir();
    const scratchB = await makeScratchDir();

    const [resultA, resultB] = await Promise.all([
      materializePerInvocation({
        parentSessionId: parentId,
        personaName,
        childSessionId: childIdA,
        scratchDirHostPath: scratchA,
      }),
      materializePerInvocation({
        parentSessionId: parentId,
        personaName,
        childSessionId: childIdB,
        scratchDirHostPath: scratchB,
      }),
    ]);

    // Both should have distinct docker names
    expect(resultA.dockerName).not.toBe(resultB.dockerName);

    // Both containers should exist in docker ps -a
    expect(dockerContainerExists(resultA.dockerName)).toBe(true);
    expect(dockerContainerExists(resultB.dockerName)).toBe(true);

    // Docker names should match the expected pattern
    const expectedNameA = perInvocationDockerName(parentId, personaName, childIdA);
    const expectedNameB = perInvocationDockerName(parentId, personaName, childIdB);
    expect(resultA.dockerName).toBe(expectedNameA);
    expect(resultB.dockerName).toBe(expectedNameB);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test 1c: concurrent per_invocation containers have isolated filesystems
  // -------------------------------------------------------------------------

  it('concurrent per_invocation containers have isolated filesystems', async () => {
    const parentId = newSessionId();
    const childIdA = newSessionId();
    const childIdB = newSessionId();
    const personaName = 'test-shell';

    const scratchA = await makeScratchDir();
    const scratchB = await makeScratchDir();

    const [{ dockerName: nameA }, { dockerName: nameB }] = await Promise.all([
      materializePerInvocation({
        parentSessionId: parentId,
        personaName,
        childSessionId: childIdA,
        scratchDirHostPath: scratchA,
      }),
      materializePerInvocation({
        parentSessionId: parentId,
        personaName,
        childSessionId: childIdB,
        scratchDirHostPath: scratchB,
      }),
    ]);

    // Write a marker file into container A's /work
    const writeResult = dockerExec(nameA, ['sh', '-c', 'echo A > /work/marker']);
    expect(writeResult.exitCode).toBe(0);

    // Container B should NOT see /work/marker
    const checkInB = dockerExec(nameB, ['test', '-f', '/work/marker']);
    expect(checkInB.exitCode).not.toBe(0);

    // Scratch dir A on the host should have the marker file
    const hostMarkerA = join(scratchA, 'marker');
    const hostMarkerB = join(scratchB, 'marker');
    const hostContentsA = await readFile(hostMarkerA, 'utf8');
    expect(hostContentsA.trim()).toBe('A');

    // Scratch dir B on the host should NOT have a marker file
    let hostBExists = false;
    try {
      await readFile(hostMarkerB, 'utf8');
      hostBExists = true;
    } catch {
      // expected — file shouldn't exist
    }
    expect(hostBExists).toBe(false);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test 2: sequential per_invocation containers don't share state
  // -------------------------------------------------------------------------

  it('sequential per_invocation containers do not share state', async () => {
    const parentId = newSessionId();
    const childIdA = newSessionId();
    const personaName = 'test-shell';
    const scratchA = await makeScratchDir();

    // First container: create, write, destroy
    const { specName: specNameA, dockerName: nameA } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childIdA,
      scratchDirHostPath: scratchA,
    });

    const writeResult = dockerExec(nameA, ['sh', '-c', 'echo first > /work/marker']);
    expect(writeResult.exitCode).toBe(0);

    await containerManager.destroy(specNameA);
    // Remove from tracking since we already destroyed it
    const idx = createdContainerNames.indexOf(nameA);
    if (idx !== -1) createdContainerNames.splice(idx, 1);

    // Second container with a DIFFERENT childSessionId and scratch dir
    const childIdB = newSessionId();
    const scratchB = await makeScratchDir();

    const { dockerName: nameB } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childIdB,
      scratchDirHostPath: scratchB,
    });

    // The second container should NOT have /work/marker (fresh container + fresh scratch dir)
    const checkResult = dockerExec(nameB, ['test', '-f', '/work/marker']);
    expect(checkResult.exitCode).not.toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test 3-smoke: concurrent persistent delegates use the same projected container
  // -------------------------------------------------------------------------

  it('concurrent persistent delegates use the same projected container', async () => {
    // Use a unique persona name to avoid colliding with any real persistent persona container on the host
    const personaName = `test-pri1796-${uuidv4().slice(0, 8)}`;
    const expectedDockerName = `box-${personaName}`;

    // Materialize the same persistent persona twice concurrently.
    // Both should adopt / share one container.
    const [resultA, resultB] = await Promise.all([
      materializePersistent({ personaName }),
      materializePersistent({ personaName }),
    ]);

    // Both specNames should be identical (persona name)
    expect(resultA.specName).toBe(resultB.specName);
    expect(resultA.dockerName).toBe(resultB.dockerName);
    expect(resultA.dockerName).toBe(expectedDockerName);

    // Only one container should exist
    const psOut = execFileSync(
      'docker',
      ['ps', '--filter', `name=^/${expectedDockerName}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 10000 }
    );
    const matchingNames = psOut
      .trim()
      .split('\n')
      .filter((n) => n.trim() === expectedDockerName);
    expect(matchingNames.length).toBe(1);

    // Write a file from one exec and confirm it's visible in another
    const writeResult = dockerExec(expectedDockerName, ['sh', '-c', 'touch /tmp/shared']);
    expect(writeResult.exitCode).toBe(0);

    const readResult = dockerExec(expectedDockerName, ['test', '-f', '/tmp/shared']);
    expect(readResult.exitCode).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test 4: sequential persistent delegates share container state
  // -------------------------------------------------------------------------

  it('sequential persistent delegates share container state', async () => {
    const personaName = `test-pri1796-seq-${uuidv4().slice(0, 8)}`;

    // First materialization
    const { specName, dockerName } = await materializePersistent({ personaName });

    // Write a marker file
    const writeResult = dockerExec(dockerName, ['sh', '-c', 'touch /tmp/persist']);
    expect(writeResult.exitCode).toBe(0);

    // Second materialization of the SAME persona (without destroying)
    // Should adopt the existing container
    const { specName: specName2, dockerName: dockerName2 } = await materializePersistent({
      personaName,
    });

    expect(specName2).toBe(specName);
    expect(dockerName2).toBe(dockerName);

    // The marker should still be present
    const checkResult = dockerExec(dockerName, ['test', '-f', '/tmp/persist']);
    expect(checkResult.exitCode).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test 6-smoke: parent reads child scratch dir from host after delegate completes
  // -------------------------------------------------------------------------

  it('parent reads child scratch dir from host after delegate completes', async () => {
    const parentId = newSessionId();
    const childId = newSessionId();
    const personaName = 'test-shell';
    const scratchDir = await makeScratchDir();

    const { dockerName } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childId,
      scratchDirHostPath: scratchDir,
    });

    // Write a file from inside the container into /work (which is bind-mounted to scratchDir)
    const writeResult = dockerExec(dockerName, ['sh', '-c', 'echo hello > /work/test.txt']);
    expect(writeResult.exitCode).toBe(0);

    // Read the file from the HOST filesystem
    const hostContent = await readFile(join(scratchDir, 'test.txt'), 'utf8');
    expect(hostContent.trim()).toBe('hello');
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test R5-smoke: per_invocation container removed from docker after idle TTL
  // -------------------------------------------------------------------------

  it('per_invocation container removed from docker after idle TTL', async () => {
    const parentId = newSessionId();
    const childId = newSessionId();
    const personaName = 'test-shell';
    const scratchDir = await makeScratchDir();

    const { specName, dockerName } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childId,
      scratchDirHostPath: scratchDir,
    });

    // Confirm the container is running
    expect(dockerContainerExists(dockerName)).toBe(true);

    // Create a reaper with a short TTL (500ms). The destroy is async (docker stop
    // may take a few seconds even for a fast container), so we wait generously.
    const reaper = new PerInvocationReaper(containerManager, { ttlMs: 500 });

    reaper.scheduleReap(childId, specName);

    // Wait for TTL + 15s grace (docker stop -t 10 can run up to 10s + rm overhead)
    await new Promise<void>((resolve) => setTimeout(resolve, 16000));

    // Container should be gone from docker ps -a
    expect(dockerContainerExists(dockerName)).toBe(false);

    // Remove from tracking since reaper already destroyed it
    const idx = createdContainerNames.indexOf(dockerName);
    if (idx !== -1) createdContainerNames.splice(idx, 1);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test Resume-1: resume within TTL reuses container + scratch
  // -------------------------------------------------------------------------

  it("resume within TTL exec's into same container", async () => {
    const parentId = newSessionId();
    const childId = newSessionId();
    const personaName = 'test-shell';
    const scratchDir = await makeScratchDir();

    // Initial materialization
    const { specName, dockerName } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childId,
      scratchDirHostPath: scratchDir,
    });

    // Write both a persistent (scratch-backed) and ephemeral (container /tmp) marker
    expect(dockerExec(dockerName, ['sh', '-c', 'echo resume-marker > /work/marker']).exitCode).toBe(
      0
    );
    expect(dockerExec(dockerName, ['sh', '-c', 'touch /tmp/in-container']).exitCode).toBe(0);

    // DO NOT destroy the container. Simulate: subagent exited but TTL hasn't elapsed.
    // "Resume" by materializing again with the SAME childSessionId and same scratch dir.
    const { specName: specName2, dockerName: dockerName2 } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childId,
      scratchDirHostPath: scratchDir,
    });

    // Should be the same container (same spec name)
    expect(specName2).toBe(specName);
    expect(dockerName2).toBe(dockerName);

    // Scratch-backed marker should be present (survived)
    const scratchCheck = dockerExec(dockerName, ['test', '-f', '/work/marker']);
    expect(scratchCheck.exitCode).toBe(0);

    // Container-ephemeral marker should also be present (container survived)
    const tmpCheck = dockerExec(dockerName, ['test', '-f', '/tmp/in-container']);
    expect(tmpCheck.exitCode).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Test Resume-2: resume after TTL spawns fresh container
  // -------------------------------------------------------------------------

  it('resume after TTL spawns fresh container', async () => {
    const parentId = newSessionId();
    const childId = newSessionId();
    const personaName = 'test-shell';
    const scratchDir = await makeScratchDir();

    // Initial materialization
    const { specName, dockerName } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childId,
      scratchDirHostPath: scratchDir,
    });

    // Write both markers
    expect(dockerExec(dockerName, ['sh', '-c', 'echo resume-marker > /work/marker']).exitCode).toBe(
      0
    );
    expect(dockerExec(dockerName, ['sh', '-c', 'touch /tmp/in-container']).exitCode).toBe(0);

    // Destroy the container (simulating TTL elapsed reap).
    // The scratch dir on the host is NOT destroyed.
    await containerManager.destroy(specName);
    const idx = createdContainerNames.indexOf(dockerName);
    if (idx !== -1) createdContainerNames.splice(idx, 1);

    // Re-materialize with the SAME childSessionId and SAME scratch dir (resume after TTL).
    // This will create a new container.
    const { dockerName: dockerName2 } = await materializePerInvocation({
      parentSessionId: parentId,
      personaName,
      childSessionId: childId,
      scratchDirHostPath: scratchDir,
    });

    // Same docker name (same childSessionId)
    expect(dockerName2).toBe(dockerName);

    // Scratch-backed /work/marker should be PRESENT (scratch dir survived on host)
    const scratchCheck = dockerExec(dockerName2, ['test', '-f', '/work/marker']);
    expect(scratchCheck.exitCode).toBe(0);

    // Container-ephemeral /tmp/in-container should be ABSENT (fresh container)
    const tmpCheck = dockerExec(dockerName2, ['test', '-f', '/tmp/in-container']);
    expect(tmpCheck.exitCode).not.toBe(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// utility: pull image if not present locally
// ---------------------------------------------------------------------------

async function pullImageIfMissing(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('docker', ['image', 'inspect', image], (err) => {
      if (!err) {
        resolve();
        return;
      }
      execFile('docker', ['pull', image], { timeout: 180_000 }, (pullErr) => {
        if (pullErr) reject(pullErr);
        else resolve();
      });
    });
  });
}
