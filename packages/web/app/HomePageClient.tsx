// ABOUTME: Client component wrapper for home page with consolidated providers
// ABOUTME: Uses new ContextProviders architecture for consistency

'use client';

import { ContextProviders } from '@/components/providers/ContextProviders';
import { HomePage } from './HomePage';

export function HomePageClient() {
  return (
    <ContextProviders>
      <HomePage />
    </ContextProviders>
  );
}
