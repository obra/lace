#!/usr/bin/env node

// ABOUTME: CLI entry point for lace with Ink UI instead of console interface
// ABOUTME: Connects existing lace backend to the new Ink-based UI

import { Command } from 'commander';
import { LaceUI } from './lace-ui.ts';

const program = new Command();

program
  .name('lace-ink')
  .description('Your lightweight agentic coding environment with Ink UI')
  .version('0.1.0')
  .option('-v, --verbose', 'enable verbose output')
  .option('--memory-path <path>', 'path to conversation database', './lace-memory.db')
  .option('--no-interactive', 'disable interactive tool approval (auto-deny dangerous tools)')
  .option('--auto-approve <tools>', 'comma-separated list of tools to auto-approve', (value) => value.split(','))
  .option('--deny <tools>', 'comma-separated list of tools to always deny', (value) => value.split(','))
  .action(async (options) => {
    const laceUI = new LaceUI(options);
    await laceUI.start();
  });

program.parse();