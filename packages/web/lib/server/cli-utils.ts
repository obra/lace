// ABOUTME: Command line argument parsing for custom server
// ABOUTME: Handles parsing and validation of CLI options for server startup

import { parseArgs } from 'util';

export interface ServerOptions {
  port?: string;
  host: string;
  help: boolean;
}

/**
 * Parses command line arguments for the server
 */
export function parseServerArgs(): ServerOptions {
  const { values } = parseArgs({
    options: {
      port: {
        type: 'string',
        short: 'p',
      },
      host: {
        type: 'string',
        short: 'h',
        default: 'localhost',
      },
      help: {
        type: 'boolean',
        default: false,
      },
    },
    strict: true,
    allowPositionals: true,
  });

  return {
    port: values.port,
    host: values.host || 'localhost',
    help: values.help || false,
  };
}

/**
 * Shows help message and exits
 */
export function showHelpAndExit(): never {
  // eslint-disable-next-line no-console -- Help text output is appropriate for CLI server
  console.log(`
Lace Web Server

Usage: npm start -- [options]

Options:
  -p, --port <port>    Port to listen on (default: 31337, auto-finds available)
  -h, --host <host>    Host to bind to (default: localhost)
                       Use '0.0.0.0' to allow external connections
  --help               Show this help message

Examples:
  npm start                        # Start on localhost:31337 (or next available)
  npm start -- --port 8080         # Start on localhost:8080 (exact port required)
  npm start -- --host 0.0.0.0      # Allow external connections
  npm run dev -- --port 3001       # Development mode on port 3001 (exact port)
`);
  process.exit(0);
}

/**
 * Shows security warning for non-localhost binding
 */
export function showSecurityWarning(hostname: string): void {
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    console.warn(`
⚠️  WARNING: Server will be accessible from external networks (binding to ${hostname})
   This may expose your local Lace instance to other devices on your network.
   Use 'localhost' to restrict access to this machine only.
`);
  }
}
