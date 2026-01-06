// ABOUTME: E2E test for system prompt injection on session/new
// Verifies that calling session/new writes a context_injected durable event with the system prompt
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

  it('writes a context_injected durable event with system prompt on session/new', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
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

    // Parse first event - should be context_injected with system prompt
    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      eventSeq: number;
      data: {
        content: Array<{ type: string; text: string }>;
        priority: string;
      };
    };

    expect(firstEvent.type).toBe('context_injected');
    expect(firstEvent.eventSeq).toBe(1);
    expect(firstEvent.data.priority).toBe('normal');
    expect(firstEvent.data.content).toBeInstanceOf(Array);
    expect(firstEvent.data.content.length).toBeGreaterThan(0);
    expect(firstEvent.data.content[0].type).toBe('text');

    // System prompt should contain persona-related content (Lace is the default persona)
    const systemPromptText = firstEvent.data.content[0].text;
    expect(systemPromptText.length).toBeGreaterThan(100); // Should be a substantial prompt
    expect(systemPromptText).toContain('Lace'); // Default persona name should appear
  });

  it('writes a context_injected event with custom persona when provided', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    // Create session with explicit persona parameter
    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir, persona: 'lace' }),
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
      data: {
        content: Array<{ type: string; text: string }>;
      };
    };

    expect(firstEvent.type).toBe('context_injected');
    expect(firstEvent.data.content[0].text).toContain('Lace');
  });

  it('context_injected event is returned via ent/session/events endpoint', async () => {
    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    await withTimeout(agent.peer.request('session/new', { workDir }), 2_000, 'session/new');

    // Query events via the protocol endpoint
    const durable = (await withTimeout(
      agent.peer.request('ent/session/events', { afterEventSeq: 0, limit: 100 }),
      2_000,
      'ent/session/events'
    )) as {
      events: Array<{
        eventSeq: number;
        type: string;
        data: { content: Array<{ type: string; text: string }>; priority: string };
      }>;
      hasMore: boolean;
    };

    expect(durable.events.length).toBeGreaterThan(0);
    expect(durable.events[0].type).toBe('context_injected');
    expect(durable.events[0].eventSeq).toBe(1);
    expect(durable.events[0].data.priority).toBe('normal');
    expect(durable.events[0].data.content[0].text).toContain('Lace');
  });

  it('injects user instructions from instructions.md as second context_injected event', async () => {
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
      agent.peer.request('session/new', { workDir }),
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

    // Should have at least 2 events: system prompt + user instructions
    expect(eventLines.length).toBeGreaterThanOrEqual(2);

    // First event should be system prompt with "Lace"
    const firstEvent = JSON.parse(eventLines[0]) as {
      type: string;
      eventSeq: number;
      data: { content: Array<{ type: string; text: string }>; priority: string };
    };
    expect(firstEvent.type).toBe('context_injected');
    expect(firstEvent.eventSeq).toBe(1);
    expect(firstEvent.data.content[0].text).toContain('Lace');

    // Second event should be user instructions
    const secondEvent = JSON.parse(eventLines[1]) as {
      type: string;
      eventSeq: number;
      data: { content: Array<{ type: string; text: string }>; priority: string };
    };
    expect(secondEvent.type).toBe('context_injected');
    expect(secondEvent.eventSeq).toBe(2);
    expect(secondEvent.data.priority).toBe('normal');
    expect(secondEvent.data.content[0].text).toContain('Custom user instruction');
  });

  it('does not inject user instructions event when instructions.md is empty', async () => {
    // Create empty instructions.md
    writeFileSync(join(laceDir, 'instructions.md'), '   '); // whitespace only

    agent = spawnAgentProcess({ laceDir });

    await withTimeout(
      agent.peer.request('initialize', defaultInitializeParams()),
      2_000,
      'initialize'
    );

    const created = (await withTimeout(
      agent.peer.request('session/new', { workDir }),
      2_000,
      'session/new'
    )) as { sessionId: string };

    const sessionDir = join(laceDir, 'agent-sessions', created.sessionId);
    const eventsPath = join(sessionDir, 'events.jsonl');

    const eventsRaw = readFileSync(eventsPath, 'utf8');
    const eventLines = eventsRaw.trim().split('\n').filter(Boolean);

    // Should only have 1 event (system prompt), no user instructions event
    expect(eventLines.length).toBe(1);
    expect(JSON.parse(eventLines[0]).type).toBe('context_injected');
    expect(JSON.parse(eventLines[0]).data.content[0].text).toContain('Lace');
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

  it('converts context_injected event to provider message with role system', () => {
    // Create a mock events.jsonl with a context_injected event
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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'You are Lace, a helpful AI assistant.',
    });
  });

  it('converts context_injected with multi-block content to single system message', () => {
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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('You are Lace.');
    expect(messages[0].content).toContain('You help with coding.');
  });

  it('places system message before user message in correct order', () => {
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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(2);
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'System prompt content',
    });
    expect(messages[1]).toEqual({
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

    const messages = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages.length).toBe(0);
  });

  it('returns empty array when events.jsonl does not exist', () => {
    const messages = buildProviderMessagesFromDurableEvents(tempDir);

    expect(messages).toEqual([]);
  });
});
