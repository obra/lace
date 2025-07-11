#!/usr/bin/env node
// ABOUTME: Main CLI entry point for Lace AI coding assistant
// ABOUTME: Parses arguments and delegates to the main application logic.

import { loadEnvFiles } from '~/config/env-loader.js';
import { parseArgs, validateProvider } from '~/cli/args.js';
import { ProviderRegistry } from '~/providers/registry.js';
import { run } from '~/app.js';

async function main() {
  // Load environment variables from .env files with hierarchy support before anything else
  loadEnvFiles();

  // Parse arguments (handles --help and --list-tools, exits early if needed)
  const options = await parseArgs();

  // Initialize provider registry for validation (only after args parsed)
  const registry = await ProviderRegistry.createWithAutoDiscovery();

  // Validate provider against registry
  validateProvider(options.provider, registry);

  // Run the application
  await run(options);
}

// Start the application
main().catch(() => {
  process.exit(1);
});
