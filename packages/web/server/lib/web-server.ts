// ABOUTME: Core Lace server library with configurable asset serving
// ABOUTME: Reusable server logic for both development and production modes

import { createRequestHandler } from '@react-router/express';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';

export interface AssetServingConfig {
  mode: 'static' | 'embedded' | 'vite';
  staticPath?: string;
  assetMap?: Record<string, string>;
  viteDevServer?: any;
}

export interface LaceServerConfig {
  port: number;
  hostname: string;
  serverBuild: any;
  assetConfig: AssetServingConfig;
  loadContext?: () => any;
}

export async function createLaceServer(config: LaceServerConfig) {
  const app = express();

  // Express middleware
  app.use(compression());
  app.disable('x-powered-by');
  app.use(morgan('tiny'));

  // Asset serving based on mode
  switch (config.assetConfig.mode) {
    case 'static':
      if (config.assetConfig.staticPath) {
        app.use(express.static(config.assetConfig.staticPath, { maxAge: '1h' }));
      }
      break;
      
    case 'embedded':
      if (config.assetConfig.assetMap) {
        app.use((req, res, next) => {
          const assetPath = config.assetConfig.assetMap![req.path];
          if (assetPath) {
            try {
              const fs = require('fs');
              const content = fs.readFileSync(assetPath, 'utf8');
              const contentType = getContentType(req.path);
              res.setHeader('content-type', contentType);
              res.setHeader('cache-control', 'public, max-age=31536000');
              res.send(content);
              return;
            } catch (error) {
              console.error(`Failed to serve embedded asset ${req.path}:`, error);
            }
          }
          next();
        });
      }
      break;
      
    case 'vite':
      if (config.assetConfig.viteDevServer) {
        app.use(config.assetConfig.viteDevServer.middlewares);
        
        // Handle SSR loading for development
        app.use(async (req, res, next) => {
          try {
            const source = await config.assetConfig.viteDevServer.ssrLoadModule('./server/app.ts');
            return await source.app(req, res, next);
          } catch (error) {
            if (typeof error === 'object' && error instanceof Error) {
              config.assetConfig.viteDevServer.ssrFixStacktrace(error);
            }
            next(error);
          }
        });
        return app; // Return early for Vite mode
      }
      break;
  }

  // React Router request handler (for static and embedded modes)
  const requestHandler = createRequestHandler({
    build: () => config.serverBuild,
    getLoadContext: config.loadContext || (() => ({})),
  });

  app.use(requestHandler);
  return app;
}

function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    'html': 'text/html',
    'js': 'application/javascript', 
    'css': 'text/css',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'txt': 'text/plain',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
}