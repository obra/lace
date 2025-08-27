// ABOUTME: Project page route for React Router v7
// ABOUTME: Project dashboard page with all providers and context setup

'use client';

import { useParams } from 'react-router';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider } from '@/components/providers/AgentProvider';
import { TaskProvider } from '@/components/providers/TaskProvider';
import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectPageContent } from '@/components/pages/ProjectPageContent';

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

export default function Project() {
  const { projectId } = useParams();

  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId!}
        onProjectSelect={noOpCallback} // No-op for individual project page
        onProjectChange={noOpCallback} // No-op for individual project page
      >
        <SessionProvider projectId={projectId!} selectedSessionId={null}>
          <AgentProvider sessionId={null} selectedAgentId={null} onAgentChange={noOpCallback}>
            <TaskProvider
              projectId={projectId!}
              sessionId={null}
              agents={[]} // No agents on project page
            >
              <ProjectPageContent projectId={projectId!} />
            </TaskProvider>
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
