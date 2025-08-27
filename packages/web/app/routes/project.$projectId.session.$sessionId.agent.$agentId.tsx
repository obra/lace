// ABOUTME: Project session agent page route for React Router v7
// ABOUTME: Agent chat page with all providers and context setup


import { useParams } from 'react-router';
import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider } from '@/components/providers/AgentProvider';
import { EventStreamProvider } from '@/components/providers/EventStreamProvider';
import { ToolApprovalProvider } from '@/components/providers/ToolApprovalProvider';
import { TaskProvider } from '@/components/providers/TaskProvider';
import { ScrollProvider } from '@/components/providers/ScrollProvider';
import { AgentPageContent } from '@/components/pages/AgentPageContent';
import type { ThreadId } from '@/types/core';

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

export default function ProjectSessionAgent() {
  const { projectId, sessionId, agentId } = useParams();

  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId!}
        onProjectSelect={noOpCallback}
        onProjectChange={noOpCallback}
      >
        <SessionProvider projectId={projectId!} selectedSessionId={sessionId!}>
          <AgentProvider
            sessionId={sessionId!}
            selectedAgentId={agentId!}
            onAgentChange={noOpCallback}
          >
            <ToolApprovalProvider agentId={agentId! as ThreadId}>
              <EventStreamProvider
                projectId={projectId!}
                sessionId={sessionId! as ThreadId}
                agentId={agentId! as ThreadId}
              >
                <TaskProvider
                  projectId={projectId!}
                  sessionId={sessionId! as ThreadId}
                  agents={[]} // Will be populated by AgentProvider
                >
                  <ScrollProvider>
                    <AgentPageContent
                      projectId={projectId!}
                      sessionId={sessionId!}
                      agentId={agentId!}
                    />
                  </ScrollProvider>
                </TaskProvider>
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
