// ABOUTME: Project dashboard page - shows sessions for a specific project
// ABOUTME: Loads project data and displays SessionConfigPanel

import { ProjectPageClient } from './ProjectPageClient';

interface ProjectPageProps {
  params: {
    projectId: string;
  };
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = params;
  return <ProjectPageClient projectId={projectId} />;
}
