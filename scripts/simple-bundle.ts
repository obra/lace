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
import zipData from '../build/lace-standalone.zip' with { type: 'file' };

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
    const zipPath = join(tempDir, 'lace-standalone.zip');

    // Use Bun's file API to read the bundled ZIP and write it out
    const zipFile = Bun.file(zipData);
    const zipBuffer = await zipFile.arrayBuffer();
    require('fs').writeFileSync(zipPath, new Uint8Array(zipBuffer));

    // Extract ZIP
    execSync(`cd "${tempDir}" && unzip -q lace-standalone.zip`, { stdio: 'pipe' });

    console.log('📁 Standalone build extracted (optimized production build)');

    console.log('✅ Standalone build extracted');
    return tempDir;
  }

  private async startLaceServer(): Promise<void> {
    console.log('🌐 Starting Lace server...');

    // Use our custom server wrapper with the standalone build
    const standaloneDir = join(this.extractedPath, 'standalone');
    const webDir = join(standaloneDir, 'packages/web');
    const serverFile = join(webDir, 'server.ts');

    if (!existsSync(serverFile)) {
      throw new Error(`Custom server not found at: ${serverFile}`);
    }

    if (!existsSync(webDir)) {
      throw new Error(`Web directory not found at: ${webDir}`);
    }

    // Set environment variables for production mode
    process.env.NODE_ENV = 'production';

    // Change to the packages/web directory where Next.js and dependencies are
    const originalCwd = process.cwd();
    process.chdir(webDir);

    // Set CLI args for our custom server (it uses parseArgs, not env vars)
    const originalArgv = process.argv;
    process.argv = [
      process.argv[0], // bun executable
      'server.ts', // script name (we're in the web directory now)
      '--port',
      String(this.options.port || 3000),
      '--host',
      this.options.host || '127.0.0.1',
    ];

    try {
      // Our custom server replaced the standalone server, so just run it from packages/web
      console.log(`📁 Running from: ${webDir}`);
      console.log(`📁 Using custom server: ${serverFile}`);
      // Bun can run TypeScript directly - use relative path since we changed to webDir
      await import('./server.ts');
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
