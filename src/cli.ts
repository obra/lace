#!/usr/bin/env node
// ABOUTME: Main CLI entry point for Lace AI coding assistant
// ABOUTME: Parses arguments and delegates to the main application logic.

import { loadEnvFile } from '~/config/env-loader';
import { parseArgs, validateProvider } from '~/cli/args';
import { ProviderRegistry } from '~/providers/registry';
import { run } from '~/app';

async function main() {
  // Load environment variables from .env file before anything else
  loadEnvFile();

  // Parse arguments (handles --help and --list-tools, exits early if needed)
  const options = parseArgs();

  // Initialize provider registry for validation (only after args parsed)
  const registry = ProviderRegistry.createWithAutoDiscovery();

  // Validate provider against registry
  validateProvider(options.provider, registry);

  // Run the application
  await run(options);
}

// Start the application
main().catch(() => {
  process.exit(1);
});
