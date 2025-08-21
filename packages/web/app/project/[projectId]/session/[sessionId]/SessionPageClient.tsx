// ABOUTME: Client component wrapper for session page with auto-redirect logic
// ABOUTME: Uses new ContextProviders and useNavigation architecture

'use client';

import React, { useEffect } from 'react';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { ContextProviders } from '@/components/providers/ContextProviders';
import { LoadingView } from '@/components/pages/views/LoadingView';
import { useNavigation } from '@/hooks/useNavigation';

interface SessionPageClientProps {
  projectId: string;
  sessionId: string;
}

// Client component that handles auto-redirect to coordinator agent
function SessionRedirect({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const navigation = useNavigation();
  const { sessionDetails } = useAgentContext();

  useEffect(() => {
    if (sessionDetails && sessionDetails.agents && sessionDetails.agents.length > 0) {
      // Find coordinator agent (has same threadId as sessionId)
      const coordinatorAgent = sessionDetails.agents.find((agent) => agent.threadId === sessionId);

      if (coordinatorAgent) {
        // Redirect to coordinator agent
        navigation.toAgent(projectId, sessionId, coordinatorAgent.threadId);
      } else if (sessionDetails.agents.length === 1) {
        // If only one agent, use it
        navigation.toAgent(projectId, sessionId, sessionDetails.agents[0].threadId);
      }
    }
  }, [sessionDetails, projectId, sessionId, navigation]);

  return <LoadingView message="Loading session..." />;
}

export function SessionPageClient({ projectId, sessionId }: SessionPageClientProps) {
  return (
    <ContextProviders projectId={projectId} sessionId={sessionId}>
      <SessionRedirect projectId={projectId} sessionId={sessionId} />
    </ContextProviders>
  );
}
