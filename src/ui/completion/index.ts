// ABOUTME: Main exports for the completion system
// ABOUTME: Provides clean API for importing completion functionality

export * from './types.js';
export { CommandCompletionProvider } from './CommandCompletionProvider.js';
export { FileCompletionProvider } from './FileCompletionProvider.js';
export { FilesAndDirectoriesCompletionProvider } from './FilesAndDirectoriesCompletionProvider.js';
export { CompletionManager } from './CompletionManager.js';

// Import for use in the convenience function
import { CommandCompletionProvider } from './CommandCompletionProvider.js';
import { FileCompletionProvider } from './FileCompletionProvider.js';
import { FilesAndDirectoriesCompletionProvider } from './FilesAndDirectoriesCompletionProvider.js';
import { CompletionManager } from './CompletionManager.js';

// Convenience function to create a fully configured completion manager
export function createCompletionManager(options?: { cwd?: string; history?: string[] }) {
  const manager = new CompletionManager({
    includeHistory: true,
    maxItems: 20,
    history: options?.history || []
  });

  // Add providers
  manager.addProvider(new CommandCompletionProvider());
  manager.addProvider(new FilesAndDirectoriesCompletionProvider({ 
    cwd: options?.cwd || process.cwd() 
  }));

  return manager;
}