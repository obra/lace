// ABOUTME: Tests that ToolExecutor.registerAllAvailableTools threads a
// PersonaRegistry into the DelegateTool so embedder-supplied user personas
// are reachable from delegate() calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolExecutor } from '../executor';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import { DelegateTool } from '../implementations/delegate';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';

function makePersonaRegistry(userPersonasDir: string): PersonaRegistry {
  // bundledPersonasPath points at a real directory containing only system
  // personas — pointing it at userPersonasDir would shadow what we're trying
  // to assert. The registry tolerates an empty bundled path.
  const emptyBundle = mkdtempSync(join(tmpdir(), 'lace-bundle-empty-'));
  return new PersonaRegistry({
    bundledPersonasPath: emptyBundle,
    userPersonasPaths: [userPersonasDir],
  });
}

describe('ToolExecutor.registerAllAvailableTools threads PersonaRegistry into DelegateTool', () => {
  let tempDir: string;
  let userPersonasDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-tool-persona-'));
    userPersonasDir = join(tempDir, 'personas');
    mkdirSync(userPersonasDir, { recursive: true });
    writeFileSync(join(userPersonasDir, 'librarian.md'), 'You are a librarian.');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('DelegateTool resolves a user persona that only exists in the supplied registry', async () => {
    const personaRegistry = makePersonaRegistry(userPersonasDir);

    const executor = new ToolExecutor();
    executor.registerAllAvailableTools(undefined, { personaRegistry });

    const delegate = executor.getTool('delegate');
    expect(delegate).toBeInstanceOf(DelegateTool);

    const jobManager = {
      createJob: vi.fn().mockResolvedValue({
        jobId: 'job_test',
        job: {
          jobId: 'job_test',
          type: 'delegate' as const,
          status: 'running' as const,
          completion: new Promise<void>(() => {}),
        } as unknown as JobState,
      }),
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await delegate!.execute(
      { prompt: 'find TODOs', persona: 'librarian', background: true },
      { signal: new AbortController().signal, jobManager }
    );

    // If the registry wiring is broken, delegate falls back to the default
    // singleton (which has no `librarian`) and returns status: 'failed' with
    // PersonaNotFoundError text.
    expect(result.status).toBe('completed');
    expect(jobManager.createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({ persona: 'librarian' })
    );
  });

  it('without explicit registry, DelegateTool falls back to the default and cannot see the user persona', async () => {
    // Sanity check — the singleton has no idea about our tempdir.
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();

    const delegate = executor.getTool('delegate');
    const jobManager = {
      createJob: vi.fn(),
      listJobs: vi.fn().mockReturnValue([]),
    } as unknown as JobManager;

    const result = await delegate!.execute(
      { prompt: 'find TODOs', persona: 'librarian', background: true },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0]?.text).toContain('librarian');
  });
});
