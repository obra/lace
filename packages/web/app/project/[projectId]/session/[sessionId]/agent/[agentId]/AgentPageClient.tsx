// ABOUTME: Client component wrapper for agent page with consolidated providers
// ABOUTME: Uses new ContextProviders architecture for consistency

'use client';

import { ContextProviders } from '@/components/providers/ContextProviders';
import { AgentPageContent } from './AgentPageContent';

interface AgentPageClientProps {
  projectId: string;
  sessionId: string;
  agentId: string;
}

export function AgentPageClient({ projectId, sessionId, agentId }: AgentPageClientProps) {
  return (
    <ContextProviders projectId={projectId} sessionId={sessionId} agentId={agentId}>
      <AgentPageContent projectId={projectId} sessionId={sessionId} agentId={agentId} />
    </ContextProviders>
  );
}
