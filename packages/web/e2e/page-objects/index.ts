// ABOUTME: Barrel export for all page object classes
// ABOUTME: Provides convenient single import point for page objects

import { Page } from '@playwright/test';
import { ProjectSelector } from './ProjectSelector';
import { ChatInterface } from './ChatInterface';

export { ProjectSelector, ChatInterface };

// Convenience function to create all page objects for a given page
export function createPageObjects(page: Page) {
  return {
    projectSelector: new ProjectSelector(page),
    chatInterface: new ChatInterface(page),
  };
}