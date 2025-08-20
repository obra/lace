// ABOUTME: Consolidated provider hierarchy for all pages
// ABOUTME: Eliminates provider duplication and provides consistent context setup

'use client';

import type { ReactNode } from 'react';
import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider } from '@/components/providers/AgentProvider';
import { EventStreamProvider } from '@/components/providers/EventStreamProvider';
import { ToolApprovalProvider } from '@/components/providers/ToolApprovalProvider';
import { TaskProvider } from '@/components/providers/TaskProvider';
import type { ThreadId } from '@/types/core';

interface ContextProvidersProps {
  projectId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  children: ReactNode;
}

export function ContextProviders({
  projectId = null,
  sessionId = null,
  agentId = null,
  children,
}: ContextProvidersProps) {
  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId}
        onProjectSelect={() => {}} // Navigation handled by PageLayout
        onProjectChange={() => {}} // Navigation handled by PageLayout
      >
        <SessionProvider projectId={projectId} selectedSessionId={sessionId}>
          <AgentProvider
            sessionId={sessionId}
            selectedAgentId={agentId}
            onAgentChange={() => {}} // Navigation handled by PageLayout
          >
            {/* Agent-specific providers only when we have an agent */}
            {agentId ? (
              <ToolApprovalProvider agentId={agentId as ThreadId}>
                <EventStreamProvider
                  projectId={projectId}
                  sessionId={sessionId as ThreadId}
                  agentId={agentId as ThreadId}
                >
                  <TaskProvider
                    projectId={projectId}
                    sessionId={sessionId as ThreadId}
                    agents={[]} // Will be populated by AgentProvider
                  >
                    {children}
                  </TaskProvider>
                </EventStreamProvider>
              </ToolApprovalProvider>
            ) : (
              <TaskProvider
                projectId={projectId}
                sessionId={sessionId as ThreadId}
                agents={[]} // Will be populated by providers above
              >
                {children}
              </TaskProvider>
            )}
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
