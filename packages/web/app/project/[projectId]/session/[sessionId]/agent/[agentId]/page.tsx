// ABOUTME: Agent chat page - main chat interface with specific agent
// ABOUTME: Loads all data for project/session/agent and displays full chat UI

import { AgentPageClient } from './AgentPageClient';

interface AgentPageProps {
  params: Promise<{
    projectId: string;
    sessionId: string;
    agentId: string;
  }>;
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { projectId, sessionId, agentId } = await params;
  return <AgentPageClient projectId={projectId} sessionId={sessionId} agentId={agentId} />;
}
