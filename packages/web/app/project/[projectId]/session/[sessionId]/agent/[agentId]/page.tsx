// ABOUTME: Agent chat page - main chat interface with specific agent
// ABOUTME: Loads all data for project/session/agent and displays full chat UI

import { AgentPageClient } from './AgentPageClient';

interface AgentPageProps {
  params: {
    projectId: string;
    sessionId: string;
    agentId: string;
  };
}

export default function AgentPage({ params }: AgentPageProps) {
  const { projectId, sessionId, agentId } = params;
  return <AgentPageClient projectId={projectId} sessionId={sessionId} agentId={agentId} />;
}
