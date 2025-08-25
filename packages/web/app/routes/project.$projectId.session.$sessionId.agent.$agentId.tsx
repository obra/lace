// ABOUTME: Project session agent page route for React Router v7
// ABOUTME: Renders the agent page using existing component with params

import { useParams } from 'react-router';
import AgentPage from '@/app/project/[projectId]/session/[sessionId]/agent/[agentId]/page';

export default function ProjectSessionAgent() {
  const { projectId, sessionId, agentId } = useParams();

  // Pass params as props to maintain compatibility
  return (
    <AgentPage
      params={{
        projectId: projectId!,
        sessionId: sessionId!,
        agentId: agentId!,
      }}
    />
  );
}
