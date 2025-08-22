// ABOUTME: Client component wrapper for home page with providers
// ABOUTME: Handles interactive logic and provider setup for project selection

'use client';

import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { HomePage } from './HomePage';

export function HomePageClient() {
  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={null}
        onProjectSelect={() => {}} // No-op - ProjectSelectorPanel handles navigation
        onProjectChange={() => {}}
      >
        <SessionProvider projectId={null} selectedSessionId={null}>
          <HomePage />
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
