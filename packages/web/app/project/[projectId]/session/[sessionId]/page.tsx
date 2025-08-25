// ABOUTME: Session page - shows agent selection and auto-redirects to coordinator agent
// ABOUTME: Loads session data and auto-selects coordinator agent for chat

import { SessionPageClient } from './SessionPageClient';

interface SessionPageProps {
  params: {
    projectId: string;
    sessionId: string;
  };
}

export default function SessionPage({ params }: SessionPageProps) {
  const { projectId, sessionId } = params;
  return <SessionPageClient projectId={projectId} sessionId={sessionId} />;
}
