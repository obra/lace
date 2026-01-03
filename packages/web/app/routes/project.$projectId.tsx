// ABOUTME: Project page route for React Router v7
// ABOUTME: Project dashboard page with all providers and context setup

import { useParams } from 'react-router';
import { ProjectsProvider } from '@lace/web/components/providers/ProjectsProvider';
import { ProjectProvider } from '@lace/web/components/providers/ProjectProvider';
import { SessionProvider } from '@lace/web/components/providers/SessionProvider';
import { UIProvider } from '@lace/web/components/providers/UIProvider';
import { ProjectPageContent } from '@lace/web/components/pages/ProjectPageContent';

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

export default function Project() {
  const { projectId } = useParams();

  return (
    <UIProvider>
      <ProjectsProvider
        selectedProject={projectId!}
        onProjectSelect={noOpCallback} // No-op for individual project page
        onProjectChange={noOpCallback} // No-op for individual project page
      >
        <ProjectProvider projectId={projectId!} selectedSessionId={null}>
          <SessionProvider sessionId={null} selectedAgentId={null} onAgentChange={noOpCallback}>
            <ProjectPageContent projectId={projectId!} />
          </SessionProvider>
        </ProjectProvider>
      </ProjectsProvider>
    </UIProvider>
  );
}
