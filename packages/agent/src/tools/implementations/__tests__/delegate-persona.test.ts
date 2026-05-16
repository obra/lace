// ABOUTME: Tests for DelegateTool persona-bundle support
// ABOUTME: Validates persona frontmatter -> subagent defaults, overrides, and resume

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DelegateTool } from '../delegate';
import { PersonaRegistry } from '@lace/agent/config/persona-registry';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { JobState } from '@lace/agent/server-types';

describe('DelegateTool persona support', () => {
  let bundledDir: string;
  let userDir: string;
  let registry: PersonaRegistry;

  beforeEach(() => {
    bundledDir = fs.mkdtempSync(path.join(tmpdir(), 'delegate-persona-bundled-'));
    userDir = fs.mkdtempSync(path.join(tmpdir(), 'delegate-persona-user-'));
  });

  afterEach(() => {
    fs.rmSync(bundledDir, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  function writePersona(name: string, frontmatter: string, body: string): void {
    fs.writeFileSync(path.join(bundledDir, `${name}.md`), `---\n${frontmatter}\n---\n${body}`);
  }

  function mkRegistry(): PersonaRegistry {
    return new PersonaRegistry({
      bundledPersonasPath: bundledDir,
      userPersonasPaths: [userDir],
    });
  }

  function mkJobManagerMock(): {
    jobManager: JobManager;
    createJob: ReturnType<typeof vi.fn>;
  } {
    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });
    const mockJob = {
      jobId: 'job_persona',
      type: 'delegate' as const,
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    } as unknown as JobState;
    setTimeout(() => resolveJob(), 10);

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_persona', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([]),
      getJobOutput: vi.fn().mockReturnValue('persona output'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;
    return { jobManager, createJob };
  }

  it('applies persona frontmatter as subagent defaults', async () => {
    writePersona(
      'librarian',
      `model: claude-3-5-sonnet
tools:
  - file_read
  - bash
mcpServers:
  fs:
    command: mcp-fs`,
      'You are a librarian.'
    );
    registry = mkRegistry();
    const tool = new DelegateTool({ personaRegistry: registry });
    const { jobManager, createJob } = mkJobManagerMock();

    const result = await tool.execute(
      { prompt: 'look up something', persona: 'librarian' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('completed');
    expect(createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        prompt: 'look up something',
        persona: 'librarian',
        modelId: 'claude-3-5-sonnet',
        personaMcpServers: { fs: { command: 'mcp-fs' } },
      })
    );
  });

  it('explicit modelId overrides persona model', async () => {
    writePersona('librarian', `model: claude-3-5-sonnet`, 'Librarian body.');
    registry = mkRegistry();
    const tool = new DelegateTool({ personaRegistry: registry });
    const { jobManager, createJob } = mkJobManagerMock();

    await tool.execute(
      { prompt: 'hi', persona: 'librarian', modelId: 'gpt-5' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        persona: 'librarian',
        modelId: 'gpt-5',
      })
    );
  });

  it('explicit connectionId overrides; persona has no connection concept', async () => {
    writePersona('librarian', `model: claude-3-5-sonnet`, 'Body.');
    registry = mkRegistry();
    const tool = new DelegateTool({ personaRegistry: registry });
    const { jobManager, createJob } = mkJobManagerMock();

    await tool.execute(
      { prompt: 'hi', persona: 'librarian', connectionId: 'conn_x' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        persona: 'librarian',
        connectionId: 'conn_x',
        modelId: 'claude-3-5-sonnet',
      })
    );
  });

  it('persona without frontmatter still loads (config empty)', async () => {
    fs.writeFileSync(path.join(bundledDir, 'plain.md'), 'Just body, no frontmatter.');
    registry = mkRegistry();
    const tool = new DelegateTool({ personaRegistry: registry });
    const { jobManager, createJob } = mkJobManagerMock();

    await tool.execute(
      { prompt: 'hi', persona: 'plain' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        persona: 'plain',
      })
    );
    const args = createJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.modelId).toBeUndefined();
    expect(args.personaMcpServers).toBeUndefined();
  });

  it('unknown persona returns failed result listing available personas', async () => {
    writePersona('librarian', '', 'body');
    writePersona('coder', '', 'body');
    registry = mkRegistry();
    const tool = new DelegateTool({ personaRegistry: registry });
    const { jobManager, createJob } = mkJobManagerMock();

    const result = await tool.execute(
      { prompt: 'hi', persona: 'nonexistent' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('nonexistent');
    expect(result.content[0].text).toContain('coder');
    expect(result.content[0].text).toContain('librarian');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('resume preserves persona binding via prior subagent session', async () => {
    writePersona('librarian', `model: claude-3-5-sonnet`, 'body');
    registry = mkRegistry();
    const tool = new DelegateTool({ personaRegistry: registry });

    let resolveJob!: () => void;
    const completion = new Promise<void>((r) => {
      resolveJob = r;
    });
    const mockJob = {
      jobId: 'job_new',
      status: 'completed' as const,
      completion,
      resolveCompletion: () => resolveJob(),
    } as unknown as JobState;
    setTimeout(() => resolveJob(), 10);

    const createJob = vi.fn().mockResolvedValue({ jobId: 'job_new', job: mockJob });
    const jobManager = {
      createJob,
      listJobs: vi.fn().mockReturnValue([{ jobId: 'job_prev', subagentSessionId: 'sess_prev' }]),
      getJobOutput: vi.fn().mockReturnValue('out'),
      finalizeJob: vi.fn(),
    } as unknown as JobManager;

    await tool.execute(
      { prompt: 'continue', resume: 'job_prev', persona: 'librarian' },
      { signal: new AbortController().signal, jobManager }
    );

    expect(createJob).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        resumeSessionId: 'sess_prev',
        persona: 'librarian',
        modelId: 'claude-3-5-sonnet',
      })
    );
  });
});
