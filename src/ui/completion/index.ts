// ABOUTME: Main exports for the completion system
// ABOUTME: Provides clean API for importing completion functionality

export * from './types.js';
export { CommandCompletionProvider } from './CommandCompletionProvider.js';
export { FileCompletionProvider } from './FileCompletionProvider.js';
export { CompletionManager } from './CompletionManager.js';

// Convenience function to create a fully configured completion manager
export function createCompletionManager(options?: { cwd?: string; history?: string[] }) {
  const { CommandCompletionProvider } = require('./CommandCompletionProvider.js');
  const { FileCompletionProvider } = require('./FileCompletionProvider.js');
  const { CompletionManager } = require('./CompletionManager.js');
  
  const manager = new CompletionManager({
    includeHistory: true,
    maxItems: 20,
    history: options?.history || []
  });

  // Add providers
  manager.addProvider(new CommandCompletionProvider());
  manager.addProvider(new FileCompletionProvider({ 
    cwd: options?.cwd || process.cwd() 
  }));

  return manager;
}