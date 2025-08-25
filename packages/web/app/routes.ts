// ABOUTME: Route configuration for React Router v7 Framework Mode
// ABOUTME: Defines all application routes using file-based routing structure

import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  // Frontend routes
  index('routes/_index.tsx'),
  route('docs', 'routes/docs.tsx'),
  route('play', 'routes/play.tsx'),
  route('font-test', 'routes/font-test.tsx'),
  route('speech-demo', 'routes/speech-demo.tsx'),
  route('sentry-test', 'routes/sentry-test.tsx'),
  route('project/:projectId', 'routes/project.$projectId.tsx', [
    route('session/:sessionId', 'routes/project.$projectId.session.$sessionId.tsx', [
      route('agent/:agentId', 'routes/project.$projectId.session.$sessionId.agent.$agentId.tsx'),
    ]),
  ]),

  // API routes
  route('api/health', 'routes/api.health.tsx'),
  route('api/events/stream', 'routes/api.events.stream.tsx'),
  route('api/threads/:threadId/message', 'routes/api.threads.$threadId.message.tsx'),
] satisfies RouteConfig;
