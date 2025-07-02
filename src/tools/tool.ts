// ABOUTME: Base class for all tools with schema-based validation
// ABOUTME: Provides automatic parameter validation and JSON schema generation

// Minimal stub to allow tests to run - will be implemented next
export abstract class Tool {
  abstract name: string;
  abstract description: string;
  abstract schema: unknown;

  get inputSchema(): unknown {
    throw new Error('Not implemented yet');
  }

  async execute(_args: unknown, _context?: unknown): Promise<unknown> {
    throw new Error('Not implemented yet');
  }

  protected abstract executeValidated(_args: unknown, _context?: unknown): Promise<unknown>;
}