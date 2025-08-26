// ABOUTME: React Router server with build files imported as Bun assets
// ABOUTME: Uses Bun's asset bundling to include all build files

// Import all React Router build files as assets
import serverIndexJs from '../packages/web/build/server/index.js' with { type: 'file' };
import serverManifestJson from '../packages/web/build/server/.vite/manifest.json' with { type: 'file' };

// Import the original server logic
import '../packages/web/server-custom.ts';

// The imported server-custom.ts should now have access to the bundled assets
console.log('✅ Server started with bundled React Router assets');