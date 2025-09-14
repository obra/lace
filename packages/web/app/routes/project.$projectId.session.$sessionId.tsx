// ABOUTME: Project session page route for React Router v7
// ABOUTME: Session page with auto-redirect logic and provider setup

import { useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import type { SessionNavigationState } from '@/types/navigation';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider, useAgentContext } from '@/components/providers/AgentProvider';
import { UIProvider } from '@/components/providers/UIProvider';

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

// Client component that handles auto-redirect to coordinator agent
function SessionRedirect({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionDetails } = useAgentContext();

  useEffect(() => {
    if (sessionDetails && sessionDetails.agents && sessionDetails.agents.length > 0) {
      // Find coordinator agent (has same threadId as sessionId)
      const coordinatorAgent = sessionDetails.agents.find((agent) => agent.threadId === sessionId);

      let targetAgent = coordinatorAgent;
      if (!targetAgent) {
        // Fallback to first agent to prevent spinner hang
        targetAgent = sessionDetails.agents[0];
      }

      if (targetAgent) {
        // Redirect to target agent, preserving navigation state
        navigate(`/project/${projectId}/session/${sessionId}/agent/${targetAgent.threadId}`, {
          replace: true,
          state: location.state as SessionNavigationState | null, // Preserve navigation state for pre-filling
        });
      }
    }
  }, [sessionDetails, projectId, sessionId, navigate, location.state]);

  return (
    <div className="flex h-screen bg-base-200 text-base-content font-ui items-center justify-center">
      <div className="text-center">
        <div className="loading loading-spinner loading-lg mb-4"></div>
        <p>Loading session...</p>
      </div>
    </div>
  );
}

export default function ProjectSession() {
  const { projectId, sessionId } = useParams();

  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId!}
        onProjectSelect={noOpCallback}
        onProjectChange={noOpCallback}
      >
        <SessionProvider projectId={projectId!} selectedSessionId={sessionId!}>
          <AgentProvider sessionId={sessionId!} selectedAgentId={null} onAgentChange={noOpCallback}>
            <SessionRedirect projectId={projectId!} sessionId={sessionId!} />
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
