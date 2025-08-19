// ABOUTME: Session page - shows agent selection and auto-redirects to coordinator agent
// ABOUTME: Loads session data and auto-selects coordinator agent for chat

import { SessionPageClient } from './SessionPageClient';

interface SessionPageProps {
  params: Promise<{
    projectId: string;
    sessionId: string;
  }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { projectId, sessionId } = await params;
  return <SessionPageClient projectId={projectId} sessionId={sessionId} />;
}