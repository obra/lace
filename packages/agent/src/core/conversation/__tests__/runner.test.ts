// ABOUTME: Tests for ConversationRunner - the agentic loop for executing prompts

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';

describe('ConversationRunner', () => {
  it('creates a runner instance with required config', () => {
    const runner = new ConversationRunner({
      sessionDir: '/tmp/test-session',
      cwd: '/tmp/test-cwd',
      onUpdate: vi.fn(),
    });
    expect(runner).toBeDefined();
    expect(runner).toBeInstanceOf(ConversationRunner);
  });

  it('accepts optional config parameters', () => {
    const onUpdate = vi.fn();
    const runner = new ConversationRunner({
      sessionDir: '/tmp/test-session',
      cwd: '/tmp/test-cwd',
      onUpdate,
      connectionId: 'test-connection',
      modelId: 'test-model',
      executionMode: 'plan',
      approvalMode: 'approveReads',
      environment: { NODE_ENV: 'test' },
      maxBudgetUsd: 10.0,
    });
    expect(runner).toBeDefined();
  });

  it('exposes sessionDir from config', () => {
    const runner = new ConversationRunner({
      sessionDir: '/tmp/my-session',
      cwd: '/tmp/test-cwd',
      onUpdate: vi.fn(),
    });
    expect(runner.sessionDir).toBe('/tmp/my-session');
  });

  describe('run()', () => {
    let sessionDir: string;
    let cwd: string;

    beforeEach(() => {
      // Create unique temp directories for each test
      const testId = randomUUID().substring(0, 8);
      sessionDir = join(tmpdir(), `lace-runner-test-session-${testId}`);
      cwd = join(tmpdir(), `lace-runner-test-cwd-${testId}`);
      mkdirSync(sessionDir, { recursive: true });
      mkdirSync(cwd, { recursive: true });

      // Initialize session files (state.json and events.jsonl)
      writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
        nextEventSeq: 1,
        nextStreamSeq: 1,
      }));
      writeFileSync(join(sessionDir, 'events.jsonl'), '');
    });

    afterEach(() => {
      // Clean up temp directories
      if (existsSync(sessionDir)) {
        rmSync(sessionDir, { recursive: true, force: true });
      }
      if (existsSync(cwd)) {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('returns a result with turnId and content when provider responds', async () => {
      const onUpdate = vi.fn();
      const runner = new ConversationRunner({
        sessionDir,
        cwd,
        onUpdate,
      });
      const provider = new TestAgentProvider();

      const result = await runner.run({
        content: [{ type: 'text', text: 'Hello, world!' }],
        provider,
      });

      expect(result).toBeDefined();
      expect(result.turnId).toMatch(/^turn_/);
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toBeDefined();
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);
    });

    it('writes prompt and message events to events.jsonl', async () => {
      const onUpdate = vi.fn();
      const runner = new ConversationRunner({
        sessionDir,
        cwd,
        onUpdate,
      });
      const provider = new TestAgentProvider();

      await runner.run({
        content: [{ type: 'text', text: 'Test prompt' }],
        provider,
      });

      const eventsPath = join(sessionDir, 'events.jsonl');
      const eventsRaw = readFileSync(eventsPath, 'utf8');
      const events = eventsRaw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // Should have at least prompt, turn_start, message, and turn_end events
      expect(events.length).toBeGreaterThanOrEqual(4);

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('prompt');
      expect(eventTypes).toContain('turn_start');
      expect(eventTypes).toContain('message');
      expect(eventTypes).toContain('turn_end');
    });

    it('emits session updates via onUpdate callback', async () => {
      const onUpdate = vi.fn();
      const runner = new ConversationRunner({
        sessionDir,
        cwd,
        onUpdate,
      });
      const provider = new TestAgentProvider();

      await runner.run({
        content: [{ type: 'text', text: 'Hello' }],
        provider,
      });

      // Should have received turn_start and turn_end updates at minimum
      expect(onUpdate).toHaveBeenCalled();
      const updateTypes = onUpdate.mock.calls.map((call) => call[0].type);
      expect(updateTypes).toContain('turn_start');
      expect(updateTypes).toContain('turn_end');
    });

    it('increments event sequence numbers correctly', async () => {
      const onUpdate = vi.fn();
      const runner = new ConversationRunner({
        sessionDir,
        cwd,
        onUpdate,
      });
      const provider = new TestAgentProvider();

      await runner.run({
        content: [{ type: 'text', text: 'First prompt' }],
        provider,
      });

      const eventsPath = join(sessionDir, 'events.jsonl');
      const eventsRaw = readFileSync(eventsPath, 'utf8');
      const events = eventsRaw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // Each event should have an incrementing eventSeq
      for (let i = 0; i < events.length; i++) {
        expect(events[i].eventSeq).toBe(i + 1);
      }
    });

    it('updates session state after run completes', async () => {
      const onUpdate = vi.fn();
      const runner = new ConversationRunner({
        sessionDir,
        cwd,
        onUpdate,
      });
      const provider = new TestAgentProvider();

      await runner.run({
        content: [{ type: 'text', text: 'Test' }],
        provider,
      });

      const stateRaw = readFileSync(join(sessionDir, 'state.json'), 'utf8');
      const state = JSON.parse(stateRaw);

      // nextEventSeq should have advanced
      expect(state.nextEventSeq).toBeGreaterThan(1);
    });
  });
});
