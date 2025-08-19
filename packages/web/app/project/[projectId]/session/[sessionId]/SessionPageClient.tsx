// ABOUTME: Client component wrapper for session page with auto-redirect logic
// ABOUTME: Handles interactive logic and provider setup for session management

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider, useAgentContext } from '@/components/providers/AgentProvider';
import { UIProvider } from '@/components/providers/UIProvider';

interface SessionPageClientProps {
  projectId: string;
  sessionId: string;
}

// Client component that handles auto-redirect to coordinator agent
function SessionRedirect({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const router = useRouter();
  const { sessionDetails } = useAgentContext();
  
  useEffect(() => {
    if (sessionDetails && sessionDetails.agents && sessionDetails.agents.length > 0) {
      // Find coordinator agent (has same threadId as sessionId)
      const coordinatorAgent = sessionDetails.agents.find(agent => agent.threadId === sessionId);
      
      if (coordinatorAgent) {
        // Redirect to coordinator agent
        router.push(`/project/${projectId}/session/${sessionId}/agent/${coordinatorAgent.threadId}`);
      } else if (sessionDetails.agents.length === 1) {
        // If only one agent, use it
        router.push(`/project/${projectId}/session/${sessionId}/agent/${sessionDetails.agents[0].threadId}`);
      }
    }
  }, [sessionDetails, projectId, sessionId, router]);

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
        onProjectSelect={() => {}}
        onProjectChange={() => {}}
      >
        <SessionProvider projectId={projectId} selectedSessionId={sessionId}>
          <AgentProvider 
            sessionId={sessionId}
            selectedAgentId={null}
            onAgentChange={() => {}}
          >
            <SessionRedirect projectId={projectId} sessionId={sessionId} />
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}