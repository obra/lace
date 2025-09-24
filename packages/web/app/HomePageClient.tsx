// ABOUTME: Client component wrapper for home page with providers
// ABOUTME: Handles interactive logic and provider setup for project selection

'use client';

import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectsProvider } from '@/components/providers/ProjectsProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { HomePage } from './HomePage';

export function HomePageClient() {
  return (
    <UIProvider>
      <ProjectsProvider
        selectedProject={null}
        onProjectSelect={() => {}} // No-op - ProjectSelectorPanel handles navigation
        onProjectChange={() => {}}
      >
        <SessionProvider projectId={null} selectedSessionId={null}>
          <HomePage />
        </SessionProvider>
      </ProjectsProvider>
    </UIProvider>
  );
}
