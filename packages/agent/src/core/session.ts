// ABOUTME: Core session utilities - config merging helpers for session/server config

import type { SessionState } from '@lace/agent/storage/session-store';
import type { AgentServerState } from '@lace/agent/server-types';

/** Server-level config type (from AgentServerState) */
export type ServerConfig = AgentServerState['config'];

/** Session-level config type (from SessionState) */
export type SessionLevelConfig = SessionState['config'];

/**
 * Merge server-level config with session-level overrides.
 * Session config takes precedence where defined.
 */
export function getEffectiveConfig(
  serverConfig: ServerConfig,
  sessionConfig?: SessionLevelConfig
): ServerConfig {
  if (!sessionConfig) return serverConfig;
  return { ...serverConfig, ...sessionConfig };
}
