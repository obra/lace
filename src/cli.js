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
  .action(async (options) => {
    const lace = new Lace(options);
    await lace.start();
  });

program.parse();