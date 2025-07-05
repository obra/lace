#!/usr/bin/env node
// ABOUTME: Main CLI entry point for Lace AI coding assistant
// ABOUTME: Parses arguments and delegates to the main application logic.

import { loadEnvFile } from './config/env-loader.js';
import { parseArgs, validateProvider } from './cli/args.js';
import { ProviderRegistry } from './providers/registry.js';
import { run } from './app.js';

async function main() {
  console.log(`[CLI] ${new Date().toISOString()} Starting main CLI execution...`);

  // Load environment variables from .env file before anything else
  loadEnvFile();

  // Parse arguments (handles --help and --list-tools, exits early if needed)
  const options = await parseArgs();

  // Initialize provider registry for validation (only after args parsed)
  const registry = await ProviderRegistry.createWithAutoDiscovery();

  // Validate provider against registry
  validateProvider(options.provider, registry);

  // Run the application
  console.log(`[CLI] ${new Date().toISOString()} About to run application...`);
  await run(options);
  console.log(`[CLI] ${new Date().toISOString()} Application run completed successfully`);
}

// Start the application
main().catch((error) => {
  console.error(`[CLI] ${new Date().toISOString()} Application exited with error:`, error);
  process.exit(1);
});
