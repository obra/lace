// ABOUTME: Project session agent page route for React Router v7
// ABOUTME: Agent chat page with all providers and context setup

import { useParams } from 'react-router';
import { UIProvider } from '@lace/web/components/providers/UIProvider';
import { ProjectsProvider } from '@lace/web/components/providers/ProjectsProvider';
import { ProjectProvider } from '@lace/web/components/providers/ProjectProvider';
import { SessionProvider } from '@lace/web/components/providers/SessionProvider';
import { EventStreamProvider } from '@lace/web/components/providers/EventStreamProvider';
import { ToolApprovalProvider } from '@lace/web/components/providers/ToolApprovalProvider';
import { TaskProvider } from '@lace/web/components/providers/TaskProvider';
import { ScrollProvider } from '@lace/web/components/providers/ScrollProvider';
import { AgentPageContent } from '@lace/web/components/pages/AgentPageContent';
import type { ThreadId } from '@lace/web/types/core';

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

export default function ProjectSessionAgent() {
  const { projectId, sessionId, agentId } = useParams();

  return (
    <UIProvider>
      <ProjectsProvider
        selectedProject={projectId!}
        onProjectSelect={noOpCallback}
        onProjectChange={noOpCallback}
      >
        <ProjectProvider projectId={projectId!} selectedSessionId={sessionId!}>
          <SessionProvider
            sessionId={sessionId!}
            selectedAgentId={agentId!}
            onAgentChange={noOpCallback}
          >
            <ToolApprovalProvider sessionId={sessionId! as ThreadId}>
              <EventStreamProvider
                key={agentId}
                projectId={projectId!}
                sessionId={sessionId! as ThreadId}
                agentId={agentId! as ThreadId}
              >
                <TaskProvider projectId={projectId!} sessionId={sessionId! as ThreadId}>
                  <ScrollProvider>
                    <AgentPageContent
                      key={agentId}
                      projectId={projectId!}
                      sessionId={sessionId!}
                      agentId={agentId!}
                    />
                  </ScrollProvider>
                </TaskProvider>
              </EventStreamProvider>
            </ToolApprovalProvider>
          </SessionProvider>
        </ProjectProvider>
      </ProjectsProvider>
    </UIProvider>
  );
}
