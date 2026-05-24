// ABOUTME: E2E test for system prompt injection on session/new
// Verifies that calling session/new writes a system_prompt_set durable event with the system prompt
// Also includes unit tests for buildProviderMessagesFromDurableEvents conversion

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgentProcess, withTimeout, type SpawnedAgent } from './helpers/agent-process';
import { defaultInitializeParams } from './helpers/initialize';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/server';

describe('system prompt injection on session/new', () => {
  let originalLaceDir: string | undefined;
  let laceDir: string;
  let workDir: string;
  let agent: SpawnedAgent | undefined;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'lace-agent-sysprompt-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-agent-sysprompt-wd-'));
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }

    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('writes a system_prompt_set durable event with system prompt on session/new', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    expect(created.sessionId).toMatch(/^sess_/);

    // Read the events.jsonl file directly from the session directory
    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    expect(existsSync(eventsPath)).toBe(true);

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    expect(eventLines.length).toBeGreaterThan(0);

    // Parse first event - should be system_prompt_set with the full system prompt text
    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      eventSeq: number;
      data: { type: string; text: string };
    };

    expect(firstEvent.type).toBe('system_prompt_set');
    expect(firstEvent.eventSeq).toBe(1);

    // System prompt should contain persona-related content (Lace is the default persona)
    const systemPromptText = firstEvent.data.text;
    expect(systemPromptText.length).toBeGreaterThan(100); // Should be a substantial prompt
    expect(systemPromptText).toContain('Lace'); // Default persona name should appear
  });

  it('writes a system_prompt_set event with custom persona when provided', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    // Create session with explicit persona parameter
    const created = (await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [], persona: 'lace' }),
      2_000,
      'session/new with persona'
    )) as { sessionId: string };

    expect(created.sessionId).toMatch(/^sess_/);

    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    expect(existsSync(eventsPath)).toBe(true);

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      data: { type: string; text: string };
    };

    expect(firstEvent.type).toBe('system_prompt_set');
    expect(firstEvent.data.text).toContain('Lace');
  });

  it('system_prompt_set event is returned via ent/session/events endpoint', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
      2_000,
      'session/new'
    );

    // Query events via the protocol endpoint
    const durable = (await withTimeout(
      agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as {
      events: Array<{
        eventSeq: number;
        type: string;
        data: { type: string; text: string };
      }>;
      hasMore: boolean;
    };

    expect(durable.events.length).toBeGreaterThan(0);
    expect(durable.events[0].type).toBe('system_prompt_set');
    expect(durable.events[0].eventSeq).toBe(1);
    expect(durable.events[0].data.text).toContain('Lace');
  });

  it('includes user instructions from instructions.md in the single system_prompt_set event', async () => {
    // Create instructions.md with custom user instructions in the LACE_DIR
    const userInstructions = 'Custom user instruction: always be helpful and concise';
    writeFileSync(join(laceDir, 'instructions.md'), userInstructions);

    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    expect(created.sessionId).toMatch(/^sess_/);

    // Read the events.jsonl file directly from the session directory
    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    expect(existsSync(eventsPath)).toBe(true);

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    // Should have exactly 1 system_prompt_set event combining persona + user instructions
    expect(eventLines.length).toBeGreaterThanOrEqual(1);

    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      eventSeq: number;
      data: { type: string; text: string };
    };
    expect(firstEvent.type).toBe('system_prompt_set');
    expect(firstEvent.eventSeq).toBe(1);
    // Both persona content and user instructions should appear in the combined text
    expect(firstEvent.data.text).toContain('Lace');
    expect(firstEvent.data.text).toContain('Custom user instruction');
  });

  it('writes a single system_prompt_set event when instructions.md is empty', async () => {
    // Create empty instructions.md
    writeFileSync(join(laceDir, 'instructions.md'), '   '); // whitespace only

    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    // Should have exactly 1 system_prompt_set event (no separate user instructions event)
    expect(eventLines.length).toBe(1);
    const firstEvent = JSON.parse(eventLines[0]) as { type: string; data: { text: string } };
    expect(firstEvent.type).toBe('system_prompt_set');
    expect(firstEvent.data.text).toContain('Lace');
  });

  it('system prompt contains the session working directory', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    // Create session with a specific working directory
    const created = (await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    // Read the system prompt from the system_prompt_set event
    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      data: { type: string; text: string };
    };

    // The system prompt should contain the working directory we passed
    // The template uses {{{project.cwd}}} which should be populated with workDir
    const systemPromptText = firstEvent.data.text;
    expect(systemPromptText).toContain(workDir);
  });

  it('system prompt contains dynamic tool descriptions', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { cwd: workDir, mcpServers: [] }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      data: { type: string; text: string };
    };

    // The system prompt should contain dynamically generated tool descriptions
    // The template uses {{#tools}}...{{/tools}} to list available tools
    // This text comes from the bash tool's description, not the static template
    const systemPromptText = firstEvent.data.text;
    expect(systemPromptText).toContain('Execute shell commands in isolated bash processes');
  });
});

describe('buildProviderMessagesFromDurableEvents', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-provider-msg-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('legacy migration: pre-prompt context_injected event (no system_prompt_set) becomes systemPrompt, not a user message', () => {
    // Without a system_prompt_set event, context_injected events that appear before the
    // first prompt are treated as the legacy system prompt (they were written at session
    // creation time to hold the persona + userInstructions).
    const contextInjectedEvent = {
      type: 'context_injected',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        content: [{ type: 'text', text: 'You are Lace, a helpful AI assistant.' }],
        priority: 'normal',
      },
    };

    writeFileSync(join(tempDir, 'events.jsonl'), JSON.stringify(contextInjectedEvent) + '\n');

    const { messages, systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(0);
    expect(systemPrompt).toBe('You are Lace, a helpful AI assistant.');
  });

  it('legacy migration: pre-prompt context_injected with multi-block content becomes systemPrompt', () => {
    // Without a system_prompt_set event, context_injected events before the first
    // prompt are consumed as the legacy system prompt — even multi-block ones.
    const contextInjectedEvent = {
      type: 'context_injected',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        content: [
          { type: 'text', text: 'You are Lace.' },
          { type: 'text', text: 'You help with coding.' },
        ],
        priority: 'normal',
      },
    };

    writeFileSync(join(tempDir, 'events.jsonl'), JSON.stringify(contextInjectedEvent) + '\n');

    const { messages, systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(0);
    expect(systemPrompt).toContain('You are Lace.');
    expect(systemPrompt).toContain('You help with coding.');
  });

  it('legacy migration: pre-prompt context_injected becomes systemPrompt and prompt becomes the only message', () => {
    // Without system_prompt_set, the pre-prompt context_injected is the legacy system
    // prompt; only the prompt event ends up in the messages array.
    const events = [
      {
        type: 'context_injected',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          content: [{ type: 'text', text: 'System prompt content' }],
          priority: 'normal',
        },
      },
      {
        type: 'prompt',
        eventSeq: 2,
        timestamp: new Date().toISOString(),
        turnId: 'turn_1',
        turnSeq: 0,
        data: {
          content: [{ type: 'text', text: 'Hello, how are you?' }],
        },
      },
    ];

    writeFileSync(
      join(tempDir, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    );

    const { messages, systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(systemPrompt).toBe('System prompt content');
    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({
      role: 'user',
      content: 'Hello, how are you?',
    });
  });

  it('ignores context_injected with empty content', () => {
    const contextInjectedEvent = {
      type: 'context_injected',
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      data: {
        content: [{ type: 'text', text: '   ' }], // whitespace only
        priority: 'normal',
      },
    };

    writeFileSync(join(tempDir, 'events.jsonl'), JSON.stringify(contextInjectedEvent) + '\n');

    const { messages } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(0);
  });

  it('returns empty messages and empty systemPrompt when events.jsonl does not exist', () => {
    const { messages, systemPrompt } = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages).toEqual([]);
    expect(systemPrompt).toBe('');
  });
});
