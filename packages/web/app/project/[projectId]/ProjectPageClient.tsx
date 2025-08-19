// ABOUTME: Client component wrapper for project page with providers
// ABOUTME: Handles interactive logic and provider setup for project dashboard

'use client';

import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider'; 
import { AgentProvider } from '@/components/providers/AgentProvider';
import { SessionConfigPanel } from '@/components/config/SessionConfigPanel';
import { UIProvider } from '@/components/providers/UIProvider';

interface ProjectPageClientProps {
  projectId: string;
}

export function ProjectPageClient({ projectId }: ProjectPageClientProps) {
  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId}
        onProjectSelect={() => {}} // No-op for individual project page
        onProjectChange={() => {}}  // No-op for individual project page
      >
        <SessionProvider projectId={projectId} selectedSessionId={null}>
          <AgentProvider 
            sessionId={null}
            selectedAgentId={null}
            onAgentChange={() => {}}
          >
            <div className="flex h-screen bg-base-200 text-base-content font-ui">
              <div className="flex-1 p-6">
                <SessionConfigPanel />
              </div>
            </div>
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}