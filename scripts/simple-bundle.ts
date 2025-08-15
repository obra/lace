// ABOUTME: Simple single-file executable that extracts and runs Next.js standalone build
// ABOUTME: Uses Bun's native capabilities instead of complex VFS system

import { execSync } from 'child_process';
import { createReadStream, createWriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import * as zlib from 'zlib';

interface ServerOptions {
  port?: number;
  host?: string;
  verbose?: boolean;
}

// Import the ZIP file as binary data using Bun's bundler
import zipData from '../build/lace-project.zip' with { type: 'file' };

class SimpleLaceServer {
  private extractedPath: string = '';
  private server: any = null;

  constructor(private options: ServerOptions = {}) {}

  async start(): Promise<void> {
    console.log('🚀 Starting Lace single-file server...');

    // Extract standalone build to temp directory
    this.extractedPath = await this.extractStandaloneBuild();

    // Start the Next.js server
    await this.startLaceServer();
  }

  private async extractStandaloneBuild(): Promise<string> {
    console.log('📦 Extracting standalone build...');

    // Create temp directory
    const tempDir = join(tmpdir(), `lace-${Date.now()}-${process.pid}`);
    mkdirSync(tempDir, { recursive: true });

    console.log(`📁 Extracting to: ${tempDir}`);

    // Use the imported ZIP file directly with Bun's API
    const zipPath = join(tempDir, 'lace-project.zip');

    // Use Bun's file API to read the bundled ZIP and write it out
    const zipFile = Bun.file(zipData);
    const zipBuffer = await zipFile.arrayBuffer();
    require('fs').writeFileSync(zipPath, new Uint8Array(zipBuffer));

    // Extract ZIP
    execSync(`cd "${tempDir}" && unzip -q lace-project.zip`, { stdio: 'pipe' });

    console.log('📁 Lace project extracted (includes all dependencies)');

    console.log('✅ Standalone build extracted');
    return tempDir;
  }

  private async startLaceServer(): Promise<void> {
    console.log('🌐 Starting Lace server...');

    // Set up Next.js to use the extracted build
    const nextDir = join(this.extractedPath, 'packages', 'web');
    if (!existsSync(join(nextDir, 'server.ts'))) {
      throw new Error(`Server file not found in: ${nextDir}`);
    }

    // Set environment variables for production mode
    process.env.NODE_ENV = 'production';

    // Change to the extracted Next.js directory
    const originalCwd = process.cwd();
    process.chdir(nextDir);

    // Set CLI args for our server
    const originalArgv = process.argv;
    process.argv = [
      process.argv[0], // bun/node executable
      'server.ts', // script name
      '--port',
      String(this.options.port || 3000),
      '--host',
      this.options.host || '127.0.0.1',
    ];

    try {
      // Import and run the Lace server from the extracted directory
      console.log(`📁 Running from: ${nextDir}`);
      const serverPath = join(nextDir, 'server.js');
      await import(serverPath);
    } catch (error) {
      // Restore original state on error
      process.chdir(originalCwd);
      process.argv = originalArgv;
      throw error;
    }
  }

  setupGracefulShutdown(): void {
    const cleanup = () => {
      console.log('🧹 Cleaning up...');
      if (this.extractedPath) {
        try {
          execSync(`rm -rf "${this.extractedPath}"`, { stdio: 'pipe' });
        } catch (error) {
          console.warn('⚠️ Failed to cleanup temp directory:', error);
        }
      }
    };

    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
  }
}

// CLI interface
function parseArgs(args: string[]): ServerOptions {
  const options: ServerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--port':
      case '-p':
        const portValue = args[++i];
        const port = parseInt(portValue);
        if (isNaN(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid port: ${portValue}`);
        }
        options.port = port;
        break;

      case '--host':
      case '-h':
        options.host = args[++i];
        break;

      case '--verbose':
      case '-v':
        options.verbose = true;
        break;

      case '--help':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Lace - Single-File AI Coding Assistant

Usage: lace-standalone [options]

Options:
  --port, -p <port>    Server port (default: 3000)
  --host, -h <host>    Server host (default: 127.0.0.1)  
  --verbose, -v        Enable verbose logging
  --help               Show this help message

Examples:
  lace-standalone                    # Start on default port 3000
  lace-standalone --port 8080        # Start on port 8080
  lace-standalone --host 0.0.0.0     # Listen on all interfaces

The server extracts and runs the complete Lace Next.js application.
`);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    const server = new SimpleLaceServer(options);
    server.setupGracefulShutdown();
    await server.start();
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  });
}

export { SimpleLaceServer };
