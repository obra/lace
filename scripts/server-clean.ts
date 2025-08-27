// ABOUTME: Clean Lace server using Bun asset loaders instead of ZIP/VFS hacks
// ABOUTME: All assets embedded via imports, served from bundled files - truly standalone

import { parseArgs } from 'util';
import { createRequestHandler } from '@react-router/express';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import { readFileSync } from 'fs';

// Import all assets that need to be bundled into the executable
// React Router client assets - embedded via generated imports
import { assetMap } from './generated-client-assets';

// React Router server build - this also needs to be embedded
import * as serverBuild from '../packages/web/build/server/index.js';

// Provider catalogs - these become file paths via --loader .json:file
import anthropicCatalog from '../packages/core/src/providers/catalog/data/anthropic.json';
import openaiCatalog from '../packages/core/src/providers/catalog/data/openai.json';
import vertexaiCatalog from '../packages/core/src/providers/catalog/data/vertexai.json';
import zaiCatalog from '../packages/core/src/providers/catalog/data/zai.json';
import xaiCatalog from '../packages/core/src/providers/catalog/data/xai.json';
import openrouterCatalog from '../packages/core/src/providers/catalog/data/openrouter.json';
import cerebrasCatalog from '../packages/core/src/providers/catalog/data/cerebras.json';
import geminiCatalog from '../packages/core/src/providers/catalog/data/gemini.json';
import groqCatalog from '../packages/core/src/providers/catalog/data/groq.json';
import azureCatalog from '../packages/core/src/providers/catalog/data/azure.json';
import lambdaCatalog from '../packages/core/src/providers/catalog/data/lambda.json';
import bedrockCatalog from '../packages/core/src/providers/catalog/data/bedrock.json';
import veniceCatalog from '../packages/core/src/providers/catalog/data/venice.json';

// Prompt templates - these become file paths via --loader .md:file
import collaborationMd from '../packages/core/src/config/prompts/sections/collaboration.md';
import examplesMd from '../packages/core/src/config/prompts/sections/examples.md';
import codeQualityMd from '../packages/core/src/config/prompts/sections/code-quality.md';
import workflowsMd from '../packages/core/src/config/prompts/sections/workflows.md';
import environmentMd from '../packages/core/src/config/prompts/sections/environment.md';
import errorRecoveryMd from '../packages/core/src/config/prompts/sections/error-recovery.md';
import interactionPatternsMd from '../packages/core/src/config/prompts/sections/interaction-patterns.md';
import corePrinciplesMd from '../packages/core/src/config/prompts/sections/core-principles.md';
import agentPersonalityMd from '../packages/core/src/config/prompts/sections/agent-personality.md';
import toolsMd from '../packages/core/src/config/prompts/sections/tools.md';
import systemMd from '../packages/core/src/config/prompts/system.md';

// Parse command line arguments (same as server-custom.ts)
const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    host: { type: 'string', short: 'h', default: 'localhost' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Lace Web Server (Clean Standalone)

Usage: lace [options]

Options:
  -p, --port <port>    Port to listen on (default: 31337, auto-finds available)
  -h, --host <host>    Host to bind to (default: localhost)
                       Use '0.0.0.0' to allow external connections
  --help               Show this help message

This is a fully standalone executable with all assets embedded.
No file extraction, no temporary directories, no external dependencies.
`);
  process.exit(0);
}

const userSpecifiedPort = !!values.port;
const requestedPort = parseInt(values.port || '31337', 10);
const hostname = values.host || 'localhost';

// Validate port
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  console.error(`Error: Invalid port number: "${values.port}" (parsed as ${requestedPort})`);
  process.exit(1);
}

// Security warning for non-localhost binding
if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
  console.warn(`
⚠️  WARNING: Server will be accessible from external networks (binding to ${hostname})
   This may expose your local Lace instance to other devices on your network.
   Use 'localhost' to restrict access to this machine only.
`);
}

// Asset serving from embedded files

// Function to get content type from file extension
function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    html: 'text/html',
    js: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    txt: 'text/plain',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
}

// Enhanced server that serves from bundled assets
async function startLaceServer() {
  // Do our port detection first
  const port = await findAvailablePort(requestedPort, userSpecifiedPort, hostname);
  const url = `http://${hostname}:${port}`;

  console.log(`🚀 Starting Lace server (fully standalone) on ${url}...`);

  const app = express();

  // Express middleware
  app.use(compression());
  app.disable('x-powered-by');
  app.use(morgan('tiny'));

  // Serve React Router client assets from embedded files
  app.use((req, res, next) => {
    const assetPath = assetMap[req.path];
    if (assetPath) {
      try {
        // Read from embedded asset file path
        const content = readFileSync(assetPath, 'utf8');
        const contentType = getContentType(req.path);

        res.setHeader('content-type', contentType);
        res.setHeader('cache-control', 'public, max-age=31536000'); // 1 year cache
        res.send(content);
        return;
      } catch (error) {
        console.error(`Failed to serve embedded asset ${req.path}:`, error);
      }
    }
    next();
  });

  // React Router request handler (for both frontend and API routes)
  const requestHandler = createRequestHandler({
    build: () => serverBuild,
    getLoadContext() {
      return {
        // Provide bundled file paths to the load context
        // This allows the resource resolver to access bundled files
        bundledAssets: {
          // Provider catalogs
          anthropicCatalog,
          openaiCatalog,
          vertexaiCatalog,
          zaiCatalog,
          xaiCatalog,
          openrouterCatalog,
          cerebrasCatalog,
          geminiCatalog,
          groqCatalog,
          azureCatalog,
          lambdaCatalog,
          bedrockCatalog,
          veniceCatalog,
          // Prompt templates
          collaborationMd,
          examplesMd,
          codeQualityMd,
          workflowsMd,
          environmentMd,
          errorRecoveryMd,
          interactionPatternsMd,
          corePrinciplesMd,
          agentPersonalityMd,
          toolsMd,
          systemMd,
        },
      };
    },
  });

  app.use(requestHandler);

  app.listen(port, hostname, () => {
    console.log(`
✅ Lace is ready!
   
   🌐 URL: ${url}
   🔒 PID: ${process.pid}
   📦 Mode: fully standalone executable
   🗂️  Assets: embedded (${Object.keys(assetMap).length} client files + JSON catalogs + MD prompts)
   📋 Data: bundled (catalogs + prompts accessible)
   
   Press Ctrl+C to stop
`);

    // Signal the actual port to parent process (for menu bar app)
    console.log(`LACE_SERVER_PORT:${port}`);
    console.log(`LACE_SERVER_URL:${url}`);
  });
}

// Port detection function (from server-custom.ts)
async function findAvailablePort(
  startPort: number,
  userSpecified: boolean,
  hostname: string
): Promise<number> {
  const { createServer } = await import('http');

  const testPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = createServer();

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          resolve(false);
        } else {
          console.error(`Server error on port ${port} (${err.code || 'unknown'}):`, err.message);
          process.exit(1);
        }
      });

      server.once('listening', () => {
        server.close(() => resolve(true));
      });

      server.listen(port, hostname);
    });
  };

  if (userSpecified) {
    const available = await testPort(startPort);
    if (!available) {
      console.error(`Error: Port ${startPort} is already in use`);
      process.exit(1);
    }
    return startPort;
  }

  for (let port = startPort; port <= startPort + 100; port++) {
    const available = await testPort(port);
    if (available) {
      return port;
    }
  }

  console.error(`Error: Could not find an available port starting from ${startPort}`);
  process.exit(1);
}

startLaceServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});
