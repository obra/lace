// ABOUTME: Client component wrapper for project page with consolidated providers
// ABOUTME: Uses new ContextProviders and PageLayout architecture for consistency

'use client';

import { useProjectContext } from '@/components/providers/ProjectProvider';
import { SessionConfigPanel } from '@/components/config/SessionConfigPanel';
import { ContextProviders } from '@/components/providers/ContextProviders';
import { PageLayout } from '@/components/layout/PageLayout';
import { useNavigation } from '@/hooks/useNavigation';

interface ProjectPageClientProps {
  projectId: string;
}

function ProjectPageContent({ projectId }: { projectId: string }) {
  const { currentProject } = useProjectContext();
  const navigation = useNavigation();

  return (
    <PageLayout
      title={`${currentProject?.name || `Project ${projectId}`} - Configuration`}
      onSelectProject={navigation.toHome}
    >
      <div className="p-6">
        <SessionConfigPanel />
      </div>
    </PageLayout>
  );
}

export function ProjectPageClient({ projectId }: ProjectPageClientProps) {
  return (
    <ContextProviders projectId={projectId}>
      <ProjectPageContent projectId={projectId} />
    </ContextProviders>
  );
}
