// ABOUTME: TypeScript interfaces and types for completion system
// ABOUTME: Defines completion items, providers, and result structures

export interface CompletionItem {
  /** The value to insert when this completion is selected */
  value: string;
  /** Optional human-readable description */
  description?: string;
  /** Type of completion for UI styling and filtering */
  type: "command" | "file" | "directory" | "history";
  /** Optional sorting priority (higher = more important) */
  priority?: number;
}

export interface CompletionResult {
  /** Array of completion items */
  items: CompletionItem[];
  /** The prefix that was matched */
  prefix: string;
  /** Whether there are more items available */
  hasMore?: boolean;
}

export interface CompletionProvider {
  /** Get completions for a given prefix */
  getCompletions(prefix: string): Promise<CompletionResult> | CompletionResult;
  /** Check if this provider should handle the given context */
  canHandle(context: CompletionContext): boolean;
}

export interface CompletionContext {
  /** Current line content */
  line: string;
  /** Cursor position within the line */
  column: number;
  /** Line number (0-based) */
  lineNumber: number;
  /** Full text content */
  fullText: string;
  /** Current working directory */
  cwd?: string;
}

export interface CompletionManagerOptions {
  /** Maximum number of completions to return */
  maxItems?: number;
  /** Whether to include history completions */
  includeHistory?: boolean;
  /** History items to use for completion */
  history?: string[];
}
