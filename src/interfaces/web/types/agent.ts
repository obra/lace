// ABOUTME: Shared type definitions for multi-agent architecture
// ABOUTME: Contains interfaces used across session and agent management

export interface AgentMetadata {
  id: string;
  name?: string;
  provider?: string;
  model?: string;
  role?: string;
  status: 'active' | 'busy' | 'idle' | 'completed';
  createdAt: string;
  lastActivity: string;
  currentTask?: string;
  messageCount: number;
}

export interface SessionInfo {
  id: string;
  name?: string;
  createdAt: string;
  lastActivity: string;
  agents: AgentMetadata[];
  status: 'active' | 'completed' | 'archived';
  metadata?: Record<string, unknown>;
}
