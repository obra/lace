// ABOUTME: Client component wrapper for session page with auto-redirect logic
// ABOUTME: Handles interactive logic and provider setup for session management

'use client';

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider, useAgentContext } from '@/components/providers/AgentProvider';
import { UIProvider } from '@/components/providers/UIProvider';

interface SessionPageClientProps {
  projectId: string;
  sessionId: string;
}

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

// Client component that handles auto-redirect to coordinator agent
function SessionRedirect({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const navigate = useNavigate();
  const { sessionDetails } = useAgentContext();

  useEffect(() => {
    if (sessionDetails && sessionDetails.agents && sessionDetails.agents.length > 0) {
      // Find coordinator agent (has same threadId as sessionId)
      const coordinatorAgent = sessionDetails.agents.find((agent) => agent.threadId === sessionId);

      if (coordinatorAgent) {
        // Redirect to coordinator agent
        navigate(`/project/${projectId}/session/${sessionId}/agent/${coordinatorAgent.threadId}`);
      } else if (sessionDetails.agents.length === 1) {
        // If only one agent, use it
        navigate(
          `/project/${projectId}/session/${sessionId}/agent/${sessionDetails.agents[0].threadId}`
        );
      }
    }
  }, [sessionDetails, projectId, sessionId, navigate]);

  return (
    <div className="flex h-screen bg-base-200 text-base-content font-ui items-center justify-center">
      <div className="text-center">
        <div className="loading loading-spinner loading-lg mb-4"></div>
        <p>Loading session...</p>
      </div>
    </div>
  );
}

export function SessionPageClient({ projectId, sessionId }: SessionPageClientProps) {
  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId}
        onProjectSelect={noOpCallback}
        onProjectChange={noOpCallback}
      >
        <SessionProvider projectId={projectId} selectedSessionId={sessionId}>
          <AgentProvider sessionId={sessionId} selectedAgentId={null} onAgentChange={noOpCallback}>
            <SessionRedirect projectId={projectId} sessionId={sessionId} />
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
