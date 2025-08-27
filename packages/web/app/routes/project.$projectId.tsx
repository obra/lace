// ABOUTME: Project page route for React Router v7
// ABOUTME: Renders the project page using existing component with params

import { useParams } from 'react-router';
import ProjectPage from '@/app/project/[projectId]/page';

export default function Project() {
  const { projectId } = useParams();

  // Pass params as regular object
  return <ProjectPage params={{ projectId: projectId! }} />;
}
