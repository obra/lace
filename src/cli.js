#!/usr/bin/env node

// ABOUTME: Main CLI entry point for lace agentic coding environment
// ABOUTME: Handles command line parsing and starts interactive session

import { Command } from 'commander';
import { Lace } from './lace.js';

const program = new Command();

program
  .name('lace')
  .description('Your lightweight agentic coding environment')
  .version('0.1.0')
  .option('-v, --verbose', 'enable verbose output')
  .option('--memory-path <path>', 'path to conversation database', './lace-memory.db')
  .option('--no-interactive', 'disable interactive tool approval (auto-deny dangerous tools)')
  .option('--auto-approve <tools>', 'comma-separated list of tools to auto-approve', (value) => value.split(','))
  .option('--deny <tools>', 'comma-separated list of tools to always deny', (value) => value.split(','))
  .option('--log-level <level>', 'stderr debug output level (debug/info/warn/error/off)', 'off')
  .option('--log-file <path>', 'file path for debug log output')
  .option('--log-file-level <level>', 'file debug output level (debug/info/warn/error/off)', 'off')
  .option('--web-port <port>', 'port for web companion interface', '3000')
  .action(async (options) => {
    const lace = new Lace(options);
    
    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down gracefully...');
      await lace.shutdown();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    try {
      await lace.start();
    } catch (error) {
      console.error('Failed to start Lace:', error);
      await lace.shutdown();
      process.exit(1);
    }
  });

program.parse();