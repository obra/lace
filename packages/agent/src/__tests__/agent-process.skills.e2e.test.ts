// ABOUTME: E2E tests for skill discovery and activation

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { createE2EContext, defaultInitializeParams } from './helpers';

function createPairedPeers(register: (peer: JsonRpcPeer) => void) {
  const aToB = new PassThrough();
  const bToA = new PassThrough();

  const clientTransport = createNdjsonStdioTransport({ readable: bToA, writable: aToB });
  const serverTransport = createNdjsonStdioTransport({ readable: aToB, writable: bToA });

  const client = new JsonRpcPeer(clientTransport, { idPrefix: 'c_' });
  const server = new JsonRpcPeer(serverTransport, { idPrefix: 'a_' });
  register(server);

  return { client, server };
}

describe('skills e2e', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-skills' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  function createSkill(name: string, description: string, body: string): string {
    const skillDir = join(ctx.workDir, '.lace', 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`
    );
    return skillDir;
  }

  it('includes skills in system prompt', async () => {
    // Create a skill in the project directory
    createSkill('commit', 'Create git commits following conventions', 'Use conventional commits.');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve' } })
      );
      await client.request('session/new', { cwd: ctx.workDir, mcpServers: [] });

      // Get events to find the system_prompt_set event with rendered system prompt
      const events = (await client.request('ent/session/events', { limit: 10 })) as {
        events: Array<{ type: string; data: { text?: string } }>;
      };

      const contextEvent = events.events.find((e) => e.type === 'system_prompt_set');
      expect(contextEvent).toBeDefined();

      const systemPrompt = contextEvent?.data?.text ?? '';

      // Verify skill is in the system prompt
      expect(systemPrompt).toContain('<available_skills>');
      expect(systemPrompt).toContain('commit');
      expect(systemPrompt).toContain('Create git commits following conventions');
    } finally {
      client.close();
      server.close();
    }
  });

  it('use_skill tool is available in tool list', async () => {
    createSkill(
      'test-skill',
      'A test skill for e2e testing',
      '# Test Skill Instructions\n\nFollow these steps:\n1. Step one\n2. Step two'
    );

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve' } })
      );
      await client.request('session/new', { cwd: ctx.workDir, mcpServers: [] });

      // Get tool list to verify use_skill is available
      const tools = (await client.request('ent/tools/list', {})) as {
        tools: Array<{ name: string; description: string }>;
      };

      const useSkillTool = tools.tools.find((t) => t.name === 'use_skill');
      expect(useSkillTool).toBeDefined();
      expect(useSkillTool?.description).toContain('skill');
    } finally {
      client.close();
      server.close();
    }
  });

  it('skills from project override global skills', async () => {
    // Create a global skill
    const globalSkillDir = join(ctx.laceDir, 'skills', 'my-skill');
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(
      join(globalSkillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: Global version\n---\n\nGlobal skill content.`
    );

    // Create a project skill with the same name
    createSkill('my-skill', 'Project version', 'Project skill content.');

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    try {
      await client.request(
        'initialize',
        defaultInitializeParams({ config: { approvalMode: 'approve' } })
      );
      await client.request('session/new', { cwd: ctx.workDir, mcpServers: [] });

      // Get events to find the system_prompt_set event with rendered system prompt
      const events = (await client.request('ent/session/events', { limit: 10 })) as {
        events: Array<{ type: string; data: { text?: string } }>;
      };

      const contextEvent = events.events.find((e) => e.type === 'system_prompt_set');
      const systemPrompt = contextEvent?.data?.text ?? '';

      // Verify project version is in the system prompt (not global)
      expect(systemPrompt).toContain('Project version');
      expect(systemPrompt).not.toContain('Global version');
    } finally {
      client.close();
      server.close();
    }
  });
});
