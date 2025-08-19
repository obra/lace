// ABOUTME: Client component wrapper for agent page with all providers
// ABOUTME: Handles interactive logic and provider setup for agent chat interface

'use client';

import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider } from '@/components/providers/AgentProvider';
import { EventStreamProvider } from '@/components/providers/EventStreamProvider';
import { ToolApprovalProvider } from '@/components/providers/ToolApprovalProvider';
import { TaskProvider } from '@/components/providers/TaskProvider';

import { AgentPageContent } from './AgentPageContent';
import type { ThreadId } from '@/types/core';

interface AgentPageClientProps {
  projectId: string;
  sessionId: string;
  agentId: string;
}

export function AgentPageClient({ projectId, sessionId, agentId }: AgentPageClientProps) {
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
            selectedAgentId={agentId}
            onAgentChange={() => {}}
          >
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
                  <AgentPageContent 
                    projectId={projectId}
                    sessionId={sessionId}
                    agentId={agentId}
                  />
                </TaskProvider>
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}