// ABOUTME: Route configuration for React Router v7 Framework Mode
// ABOUTME: Defines all application routes using file-based routing structure

import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  // Frontend routes
  index('routes/_index.ts'),
  route('docs', 'routes/docs.ts'),
  route('play', 'routes/play.ts'),
  route('font-test', 'routes/font-test.ts'),
  route('speech-demo', 'routes/speech-demo.ts'),
  route('sentry-test', 'routes/sentry-test.ts'),
  route('project/:projectId', 'routes/project.$projectId.ts', [
    route('session/:sessionId', 'routes/project.$projectId.session.$sessionId.ts', [
      route('agent/:agentId', 'routes/project.$projectId.session.$sessionId.agent.$agentId.ts'),
    ]),
  ]),

  // API routes
  route('api/health', 'routes/api.health.ts'),
  route('api/events/stream', 'routes/api.events.stream.ts'),
  route('api/sentry-test', 'routes/api.sentry-test.ts'),
  route('api/tunnel', 'routes/api.tunnel.ts'),

  // Agent management routes
  route('api/agents/:agentId', 'routes/api.agents.$agentId.ts'),
  route('api/agents/:agentId/message', 'routes/api.agents.$agentId.message.ts'),
  route('api/agents/:agentId/stop', 'routes/api.agents.$agentId.stop.ts'),
  route('api/agents/:agentId/history', 'routes/api.agents.$agentId.history.ts'),

  // Project management routes
  route('api/projects', 'routes/api.projects.ts'),
  route('api/projects/:projectId', 'routes/api.projects.$projectId.ts'),
  route('api/projects/:projectId/configuration', 'routes/api.projects.$projectId.configuration.ts'),
  route('api/projects/:projectId/sessions', 'routes/api.projects.$projectId.sessions.ts'),
  route(
    'api/projects/:projectId/sessions/:sessionId/tasks',
    'routes/api.projects.$projectId.sessions.$sessionId.tasks.ts'
  ),
  route(
    'api/projects/:projectId/sessions/:sessionId/tasks/:taskId/notes',
    'routes/api.projects.$projectId.sessions.$sessionId.tasks.$taskId.notes.ts'
  ),

  // Session management routes
  route('api/sessions/:sessionId', 'routes/api.sessions.$sessionId.ts'),
  route('api/sessions/:sessionId/agents', 'routes/api.sessions.$sessionId.agents.ts'),
  route('api/sessions/:sessionId/configuration', 'routes/api.sessions.$sessionId.configuration.ts'),
  route('api/sessions/:sessionId/history', 'routes/api.sessions.$sessionId.history.ts'),

  // Provider management routes
  route('api/provider/catalog', 'routes/api.provider.catalog.ts'),
  route('api/provider/instances', 'routes/api.provider.instances.ts'),
  route('api/provider/instances/:instanceId', 'routes/api.provider.instances.$instanceId.ts'),
  route(
    'api/provider/instances/:instanceId/test',
    'routes/api.provider.instances.$instanceId.test.ts'
  ),

  // Thread and approval routes
  route('api/threads/:threadId/message', 'routes/api.threads.$threadId.message.ts'),
  route(
    'api/threads/:threadId/approvals/pending',
    'routes/api.threads.$threadId.approvals.pending.ts'
  ),
  route(
    'api/threads/:threadId/approvals/:toolCallId',
    'routes/api.threads.$threadId.approvals.$toolCallId.ts'
  ),

  // Filesystem and debug routes
  route('api/filesystem/list', 'routes/api.filesystem.list.ts'),
  route('api/debug/console', 'routes/api.debug.console.ts'),
] satisfies RouteConfig;
