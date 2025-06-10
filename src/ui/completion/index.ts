// ABOUTME: Main exports for the completion system
// ABOUTME: Provides clean API for importing completion functionality

export * from "./types.js";
export { CommandCompletionProvider } from "./CommandCompletionProvider.js";
export { FileCompletionProvider } from "./FileCompletionProvider.js";
export { FilesAndDirectoriesCompletionProvider } from "./FilesAndDirectoriesCompletionProvider.js";
export { CompletionManager } from "./CompletionManager.js";

// Import for use in the convenience function
import { CommandCompletionProvider } from "./CommandCompletionProvider.js";
import { FileCompletionProvider } from "./FileCompletionProvider.js";
import { FilesAndDirectoriesCompletionProvider } from "./FilesAndDirectoriesCompletionProvider.js";
import { CompletionManager } from "./CompletionManager.js";

// Import the command system
import { CommandManager } from "../commands/CommandManager";
import { getAllCommands } from "../commands/registry";

// Convenience function to create a fully configured completion manager
export function createCompletionManager(options?: {
  cwd?: string;
  history?: string[];
  commandManager?: CommandManager;
}) {
  const manager = new CompletionManager({
    includeHistory: true,
    maxItems: 20,
    history: options?.history || [],
  });

  // Create command manager if not provided
  const commandManager = options?.commandManager || new CommandManager();
  if (!options?.commandManager) {
    // Register default commands if we created a new manager
    commandManager.registerAll(getAllCommands());
  }

  // Add providers
  manager.addProvider(new CommandCompletionProvider(commandManager));
  manager.addProvider(
    new FilesAndDirectoriesCompletionProvider({
      cwd: options?.cwd || process.cwd(),
    }),
  );

  return manager;
}
