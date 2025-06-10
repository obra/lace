#!/usr/bin/env node

// ABOUTME: CLI entry point for lace with Ink UI instead of console interface
// ABOUTME: Connects existing lace backend to the new Ink-based UI

import { Command } from "commander";
import { LaceUI } from "./lace-ui.ts";

const program = new Command();

program
  .name("lace-ink")
  .description("Your lightweight agentic coding environment with Ink UI")
  .version("0.1.0")
  .option("-v, --verbose", "enable verbose output")
  .option(
    "--memory-path <path>",
    "path to conversation database",
    "./lace-memory.db",
  )
  .option(
    "--activity-log-path <path>",
    "path to activity log database",
    ".lace/activity.db",
  )
  .option(
    "--log-level <level>",
    "console log level (debug|info|warn|error|off)",
    "off",
  )
  .option("--log-file <path>", "log file path for debug output")
  .option(
    "--log-file-level <level>",
    "file log level (debug|info|warn|error|off)",
    "debug",
  )
  .option(
    "--no-interactive",
    "disable interactive tool approval (auto-deny dangerous tools)",
  )
  .option(
    "--auto-approve <tools>",
    "comma-separated list of tools to auto-approve",
    (value) => value.split(","),
  )
  .option(
    "--deny <tools>",
    "comma-separated list of tools to always deny",
    (value) => value.split(","),
  )
  .action(async (options) => {
    const laceUIOptions = {
      ...options,
    };

    const laceUI = new LaceUI(laceUIOptions);
    await laceUI.start();
  });

program.parse();
