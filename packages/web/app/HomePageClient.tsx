// ABOUTME: Client component wrapper for home page with providers
// ABOUTME: Handles interactive logic and provider setup for project selection

'use client';

import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectsProvider } from '@/components/providers/ProjectsProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { HomePage } from './HomePage';

const noop = () => {};

export function HomePageClient() {
  return (
    <UIProvider>
      <ProjectsProvider
        selectedProject={null}
        onProjectSelect={noop} // No-op - ProjectSelectorPanel handles navigation
        onProjectChange={noop}
      >
        <ProjectProvider projectId={null} selectedSessionId={null}>
          <HomePage />
        </ProjectProvider>
      </ProjectsProvider>
    </UIProvider>
  );
}
