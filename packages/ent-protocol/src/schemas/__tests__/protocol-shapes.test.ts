import { describe, expect, it } from 'vitest';
import {
  EntProtocolNotificationSchema,
  EntProtocolRequestSchema,
  EntAgentPingResponseSchema,
  EntSessionEventsResponseSchema,
  InitializeResponseSchema,
  SessionNewResponseSchema,
  SessionPromptResponseSchema,
  SessionRequestPermissionResponseSchema,
} from '../methods';

function boundedHostRuntimeBinding(cwd = '/tmp') {
  return {
    schemaVersion: 1,
    identity: { runtimeId: 'rt_bounded_host_protocol' },
    agentPlacement: 'host',
    toolRuntime: { type: 'boundedHost', root: cwd, cwd },
  };
}

function boundedHostWorkspaceRuntimeBinding(cwd = '/project') {
  return {
    schemaVersion: 1,
    identity: { runtimeId: 'rt_bounded_host_wide_root_protocol' },
    agentPlacement: 'host',
    toolRuntime: {
      type: 'boundedHost',
      root: '/tmp/workspace',
      cwd,
    },
  };
}

function containerRuntimeBinding() {
  return {
    schemaVersion: 1,
    identity: { runtimeId: 'rt_container_protocol' },
    agentPlacement: 'host',
    toolRuntime: {
      type: 'container',
      cwd: '/workspace',
      spec: {
        name: 'projected-runtime',
        requestedImage: 'example/app:latest',
        resolvedImageDigest:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        imagePlatform: 'linux/arm64',
        workingDirectory: '/workspace',
        mounts: [{ hostPath: '/host/repo', containerPath: '/workspace', readonly: false }],
        env: { NODE_ENV: 'test' },
        secretEnv: { API_KEY: { namespace: 'session', name: 'api-key' } },
        ports: [{ host: 3000, container: 3000 }],
        restartPolicy: 'unless-stopped',
      },
      helper: {
        mode: 'mount',
        hostPath: '/host/lace-runtime-helper',
        containerPath: '/usr/local/bin/lace-runtime-helper',
        command: ['/usr/local/bin/lace-runtime-helper'],
      },
    },
  };
}

describe('protocol shapes (representative examples)', () => {
  it('parses representative client->agent requests', () => {
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          config: { approvalMode: 'ask' },
        },
      })
    ).not.toThrow();

    // initialize with embedder-supplied skillDirs is accepted.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-skilldirs',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          skillDirs: ['/tmp/knowledge/skills', '/tmp/school/skills'],
        },
      })
    ).not.toThrow();

    // empty string entries in skillDirs are rejected.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-bad-skilldirs',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          skillDirs: [''],
        },
      })
    ).toThrow();

    // initialize with embedder-supplied containerMounts is accepted.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-containermounts',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          containerMounts: {
            scratch: { hostPath: '/var/lace/scratch', readonly: false },
            knowledge: { hostPath: '/var/lace/knowledge', readonly: true },
          },
        },
      })
    ).not.toThrow();

    // initialize with embedder-supplied containerExecutionIdentity is accepted.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-container-execution-identity',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          containerExecutionIdentity: { tokenEnvName: 'AGENT_TOKEN' },
        },
      })
    ).not.toThrow();

    // unsafe containerExecutionIdentity token env var names are rejected.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-bad-container-execution-identity',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          containerExecutionIdentity: { tokenEnvName: 'bad-name' },
        },
      })
    ).toThrow();

    // invalid mount name (uppercase) is rejected.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-bad-mount-name',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          containerMounts: {
            Scratch: { hostPath: '/var/lace/scratch', readonly: false },
          },
        },
      })
    ).toThrow();

    // missing readonly on a mount entry is rejected.
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'init-bad-mount-shape',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          clientInfo: { name: 'test-client', version: '0.0.0' },
          capabilities: { streaming: true },
          containerMounts: {
            scratch: { hostPath: '/var/lace/scratch' },
          },
        },
      })
    ).toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_2',
        method: 'session/new',
        params: {
          cwd: '/tmp',
          persona: 'lace',
          systemPrompt: { type: 'preset', preset: 'lace' },
          mcpServers: [],
        },
      })
    ).not.toThrow();

    for (const request of [
      {
        method: 'session/new',
        params: {
          cwd: '/tmp',
          mcpServers: [],
          config: { runtimeBinding: boundedHostRuntimeBinding() },
        },
      },
      {
        method: 'session/load',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/tmp',
          mcpServers: [],
          config: { runtimeBinding: boundedHostRuntimeBinding() },
        },
      },
      {
        method: 'session/resume',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/tmp',
          mcpServers: [],
          config: { runtimeBinding: boundedHostRuntimeBinding() },
        },
      },
    ]) {
      expect(() =>
        EntProtocolRequestSchema.parse({
          jsonrpc: '2.0',
          id: `${request.method}-runtime-binding`,
          method: request.method,
          params: request.params,
        })
      ).not.toThrow();
    }

    for (const runtimeBinding of [
      boundedHostWorkspaceRuntimeBinding(),
      containerRuntimeBinding(),
    ]) {
      expect(() =>
        EntProtocolRequestSchema.parse({
          jsonrpc: '2.0',
          id: `session-new-${runtimeBinding.toolRuntime.type}-runtime-binding`,
          method: 'session/new',
          params: {
            cwd: '/tmp',
            mcpServers: [],
            config: { runtimeBinding },
          },
        })
      ).not.toThrow();
    }

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_2_workdir',
        method: 'session/new',
        params: {
          workDir: '/tmp',
          persona: 'lace',
        },
      })
    ).toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_load',
        method: 'session/load',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/tmp',
          mcpServers: [{ name: 'disabled', command: '/usr/bin/true', enabled: false }],
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_resume',
        method: 'session/resume',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          cwd: '/tmp',
          mcpServers: [{ name: 'disabled', command: '/usr/bin/true', enabled: false }],
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_close',
        method: 'session/close',
        params: { sessionId: 'sess_00000000-0000-0000-0000-000000000001' },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 'c_3',
        method: 'session/prompt',
        params: {
          content: [{ type: 'text', text: 'hello' }],
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 4,
        method: 'ent/agent/ping',
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 5,
        method: 'ent/session/events',
        params: { afterEventSeq: 10, limit: 50 },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 6,
        method: 'ent/session/compact',
        params: { strategy: 'summarize', targetTokens: 1000, preserveRecent: 25 },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 7,
        method: 'ent/session/rewind',
        params: { toEventSeq: 123 },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 8,
        method: 'ent/session/checkpoint',
        params: { label: 'before-refactor' },
      })
    ).not.toThrow();

    // MCP server management methods
    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 9,
        method: 'ent/mcp/servers/list',
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 10,
        method: 'ent/mcp/servers/upsert',
        params: {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          transport: 'http',
          placement: 'host',
          secretEnv: { API_KEY: { namespace: 'project', name: 'api-key' } },
          enabled: true,
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 11,
        method: 'ent/mcp/servers/delete',
        params: { serverId: 'test-server' },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 12,
        method: 'ent/mcp/servers/test',
        params: { serverId: 'test-server' },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolRequestSchema.parse({
        jsonrpc: '2.0',
        id: 13,
        method: 'ent/mcp/tools/list',
        params: { serverId: 'test-server' },
      })
    ).not.toThrow();
  });

  it('parses representative agent->client notifications', () => {
    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'ent/session/inject',
        params: {
          content: [{ type: 'text', text: 'system prompt' }],
          priority: 'immediate',
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: 'sess_00000000-0000-0000-0000-000000000001' },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          streamSeq: 1,
          turnId: 'turn_1',
          turnSeq: 1,
          type: 'text_delta',
          text: 'hi',
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          streamSeq: 2,
          type: 'job_started',
          jobId: 'job_container_identity',
          jobType: 'delegate',
          containerExecutionMetadata: {
            tokenEnvName: 'AGENT_TOKEN',
            token: 'abc123',
            personaName: 'browser-driver',
            parentSessionId: 'sess_00000000-0000-0000-0000-000000000001',
            jobId: 'job_container_identity',
            containerId: 'lace-parent-browser-child',
            runtimeId: 'rt_projected_identity',
            containerSpecName: 'parent-browser-child',
          },
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          streamSeq: 3,
          type: 'job_started',
          jobId: 'job_container_identity_without_container_id',
          jobType: 'delegate',
          containerExecutionMetadata: {
            tokenEnvName: 'AGENT_TOKEN',
            token: 'abc123',
            personaName: 'browser-driver',
            parentSessionId: 'sess_00000000-0000-0000-0000-000000000001',
            jobId: 'job_container_identity_without_container_id',
            runtimeId: 'rt_projected_identity',
            containerSpecName: 'parent-browser-child',
          },
        },
      })
    ).not.toThrow();

    expect(() =>
      EntProtocolNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          streamSeq: 4,
          type: 'job_started',
          jobId: 'job_container_identity',
          jobType: 'delegate',
          containerExecutionMetadata: {
            tokenEnvName: 'bad-name',
            token: 'abc123',
            personaName: 'browser-driver',
            parentSessionId: 'sess_00000000-0000-0000-0000-000000000001',
            jobId: 'job_container_identity',
            containerId: 'lace-parent-browser-child',
          },
        },
      })
    ).toThrow();
  });

  it('parses representative responses', () => {
    expect(() =>
      InitializeResponseSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '1.0',
          agentInfo: { name: 'lace-agent', version: '0.0.0' },
          capabilities: {
            streaming: true,
            multiTurn: true,
            tools: [
              {
                name: 'read_file',
                description: 'read a file',
                kind: 'read',
                inputSchema: { type: 'object' },
              },
            ],
            'ent/contextInjection': true,
            'ent/backgroundJobs': true,
            'ent/fileCheckpointing': false,
            'ent/structuredOutput': false,
          },
        },
      })
    ).not.toThrow();

    expect(() =>
      SessionNewResponseSchema.parse({
        jsonrpc: '2.0',
        id: 'c_2',
        result: {
          sessionId: 'sess_00000000-0000-0000-0000-000000000001',
          created: '2026-01-04T00:00:00Z',
        },
      })
    ).not.toThrow();

    expect(() =>
      SessionPromptResponseSchema.parse({
        jsonrpc: '2.0',
        id: 'c_3',
        result: {
          turnId: 'turn_1',
          stopReason: 'end_turn',
          content: [{ type: 'text', text: 'done' }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      })
    ).not.toThrow();

    expect(() =>
      EntAgentPingResponseSchema.parse({
        jsonrpc: '2.0',
        id: 4,
        result: {
          ok: true,
          timestamp: '2026-01-04T00:00:00Z',
        },
      })
    ).not.toThrow();

    expect(() =>
      EntSessionEventsResponseSchema.parse({
        jsonrpc: '2.0',
        id: 5,
        result: {
          events: [
            {
              eventSeq: 11,
              timestamp: '2026-01-04T00:00:00Z',
              type: 'message',
              data: { role: 'assistant' },
            },
          ],
          hasMore: false,
        },
      })
    ).not.toThrow();

    expect(() =>
      SessionRequestPermissionResponseSchema.parse({
        jsonrpc: '2.0',
        id: 'a_1',
        result: { decision: 'allow' },
      })
    ).not.toThrow();
  });
});
