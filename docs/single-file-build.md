# Single-File Executable Build System

This document describes Lace's single-file executable build system that packages the entire Next.js web interface into a self-contained binary for easy distribution and deployment.

## Overview

The single-file build creates a Bun-compiled executable that contains:
- Complete Next.js standalone build (optimized for production)
- All runtime dependencies (including native modules)
- Custom server with enhanced UX features
- Automatic port detection and browser opening
- Self-extracting ZIP archive with proper module resolution

## Architecture

### Build Process Flow
```
1. NFT Dependency Tracing → scripts/trace-server-dependencies.mjs
2. Next.js Standalone Build → packages/web/.next/standalone/
3. ZIP Creation → lace-standalone.zip
4. Bun Compilation → lace-standalone (executable)
```

### Key Components

**NFT Dependency Tracing** (`scripts/trace-server-dependencies.mjs`)
- Uses `@vercel/nft` to trace server dependencies
- Forces tracing of dynamic imports through temporary static import files
- Transforms paths from `packages/web/node_modules/...` to `node_modules/...`
- Generates dependency list for Next.js `outputFileTracingIncludes`

**Next.js Configuration** (`packages/web/next.config.ts`)
- Reads NFT trace results from `server-dependencies.json`
- Configures `outputFileTracingIncludes` with traced dependencies
- Sets `outputFileTracingRoot` to project root for proper path resolution

**Custom Server** (`packages/web/server-custom.ts`)
- Enhanced wrapper around Next.js `startServer`
- Automatic port detection (finds available port starting from 31337)
- Browser opening functionality using properly traced `open` package
- Working directory management for standalone builds

**Build Scripts**
- `build:standalone:clean`: Full clean build with cache clearing
- `build:standalone`: Standard build without cache clearing
- `scripts/build-simple.ts`: ZIP creation and Bun compilation orchestration

## Usage

### Building the Executable

```bash
# Full clean build (recommended)
bun run build:standalone:clean

# Quick build (reuses caches)
bun run build:standalone
```

### Running the Executable

```bash
# Run with default settings (port 31337, auto-detect available)
./lace-standalone

# Run with specific port
./lace-standalone --port 8080

# Run with custom host (allow external connections)
./lace-standalone --host 0.0.0.0 --port 3000

# Show help
./lace-standalone --help
```

### Runtime Behavior

1. **Extraction**: Executable extracts standalone build to temporary directory
2. **Setup**: Changes working directory to standalone root for proper module resolution
3. **Port Detection**: Finds available port starting from requested port
4. **Server Start**: Launches Next.js server with enhanced features
5. **Browser Opening**: Automatically opens browser if running interactively

## Dependency Tracing Deep Dive

### The Problem

Next.js standalone builds use Node File Trace (NFT) to determine which files to include, but:
- Dynamic imports (like `await import('open')`) aren't automatically traced
- `outputFileTracingIncludes` only copies specified files without dependency analysis
- Complex packages like `open` have many transitive dependencies

### The Solution

**Step 1: Force NFT to Trace Dynamic Imports**
```javascript
// Create temporary file with static imports
const tempContent = `
import 'open';
import 'default-browser';
import 'bundle-name';
// ... all packages used dynamically
`;
```

**Step 2: Run NFT with Same Config as Next.js**
```javascript
const result = await nodeFileTrace([serverFile, tempFile], {
  base: projectRoot,
  processCwd: webDir,
  mixedModules: true,
  // ... filesystem operations
});
```

**Step 3: Transform Paths for Standalone Build**
```javascript
// Transform packages/web/node_modules/... to node_modules/...
const includePatterns = tracedFiles
  .filter(file => file.includes('/node_modules/'))
  .map(file => file.replace('packages/web/node_modules/', 'node_modules/'));
```

**Step 4: Integration with Next.js Build**
```typescript
// next.config.ts
outputFileTracingIncludes: {
  '/': [
    'packages/web/server-custom.ts',
    ...getServerDependencies() // Reads NFT trace results
  ]
}
```

## Build Artifacts

### Generated Files

- `lace-standalone`: Final executable (self-contained binary)
- `lace-standalone.zip`: Source archive embedded in executable
- `packages/web/server-dependencies.json`: NFT trace results
- `packages/web/.next/`: Next.js build artifacts

### ZIP Structure
```
standalone/
├── packages/web/           # Next.js app
│   ├── .next/             # Build artifacts
│   ├── server.ts          # Custom server
│   └── node_modules/      # App-specific dependencies
├── node_modules/          # Traced dependencies (open, is-docker, etc.)
├── package.json           # Root package.json
└── ...                    # Other project files
```

## Troubleshooting

### Common Issues

**Missing Dependencies**
- Check `server-dependencies.json` for traced files
- Verify NFT found all required packages (`hasOpen: true`, `hasIsDocker: true`)
- Look for path transformation errors in build logs

**Module Resolution Failures**
- Ensure server changes working directory to standalone root
- Check that dependencies are at `node_modules/...` not `packages/web/node_modules/...`
- Verify `outputFileTracingRoot` is set correctly

**Browser Opening Not Working**
- Check if running interactively (`stdin.isTTY && stdout.isTTY`)
- Look for `open` package in ZIP: `unzip -l lace-standalone.zip | grep open`
- Debug with console logs in server-custom.ts

**Build Failures**
- Clear all caches: `rm -rf build packages/web/.next packages/web/server.js`
- Check TypeScript compilation errors
- Verify Bun is properly installed and updated

### Debug Commands

```bash
# Check NFT trace results
cat packages/web/server-dependencies.json

# Verify ZIP contents
unzip -l lace-standalone.zip | grep node_modules/open

# Test dependency tracing
bun scripts/trace-server-dependencies.mjs

# Clean build from scratch
rm -rf build packages/web/.next packages/web/server.js && bun run build:standalone:clean
```

## Performance Considerations

- **Build Time**: NFT tracing adds ~2-5 seconds to build process
- **ZIP Size**: Traced dependencies add ~500KB to final executable
- **Startup Time**: Extraction to temp directory adds ~100ms
- **Memory**: Temporary extraction requires disk space (typically ~50MB)

## Future Improvements

- **Caching**: Cache NFT results to speed up incremental builds
- **Optimization**: Minimize traced dependency set
- **Platforms**: Support for additional Bun target platforms
- **Compression**: Better compression for embedded ZIP archive

## Implementation Notes

### Database Compatibility

The build system includes fixes for Bun SQLite compatibility:

```typescript
// Fixed: Bun SQLite API differs from better-sqlite3
this.db.exec('PRAGMA journal_mode = WAL');  // ✅ Works in both
// this.db.pragma('journal_mode = WAL');    // ❌ better-sqlite3 only
```

### Path Resolution

Critical for proper module resolution in standalone builds:

```typescript
// Change to standalone root (like Next.js does)
const standaloneRoot = path.resolve(__dirname, '../..');
process.chdir(standaloneRoot);
```

### Dynamic Import Handling

The system handles dynamic imports by pre-tracing them:

```typescript
// Runtime: This works because dependencies were pre-traced
const { default: open } = await import('open');
await open(url);
```

## Security Considerations

- Temporary extraction directory is created with secure permissions
- Extracted files are cleaned up on process exit
- No network dependencies required for runtime execution
- Self-contained execution prevents dependency confusion attacks