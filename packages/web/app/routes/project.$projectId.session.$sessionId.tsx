// ABOUTME: Project session page route for React Router v7
// ABOUTME: Renders the session page using existing component with params

import { useParams } from 'react-router';
import SessionPage from '@/app/project/[projectId]/session/[sessionId]/page';

export default function ProjectSession() {
  const { projectId, sessionId } = useParams();

  // Pass params as props to maintain compatibility
  return <SessionPage params={{ projectId: projectId!, sessionId: sessionId! }} />;
}
