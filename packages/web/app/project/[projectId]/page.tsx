// ABOUTME: Project dashboard page - shows sessions for a specific project
// ABOUTME: Loads project data and displays SessionConfigPanel

import { ProjectPageClient } from './ProjectPageClient';

interface ProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  return <ProjectPageClient projectId={projectId} />;
}
