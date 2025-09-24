// ABOUTME: Client component wrapper for home page with providers
// ABOUTME: Handles interactive logic and provider setup for project selection

'use client';

import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectsProvider } from '@/components/providers/ProjectsProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { HomePage } from './HomePage';

export function HomePageClient() {
  return (
    <UIProvider>
      <ProjectsProvider
        selectedProject={null}
        onProjectSelect={() => {}} // No-op - ProjectSelectorPanel handles navigation
        onProjectChange={() => {}}
      >
        <ProjectProvider projectId={null} selectedSessionId={null}>
          <HomePage />
        </ProjectProvider>
      </ProjectsProvider>
    </UIProvider>
  );
}
