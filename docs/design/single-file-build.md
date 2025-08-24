# Single-File Executable Build System

This document describes Lace's single-file executable build system that packages the entire Next.js web interface into a self-contained binary for easy distribution and deployment.

## Overview

The single-file build creates a Bun-compiled executable that contains:
- Complete Next.js standalone build (optimized for production)
- All runtime dependencies (including native modules)
- Custom server with enhanced UX features
- Automatic port detection
- Self-extracting ZIP archive with proper module resolution

## Architecture

### Build Process Flow
```
1. Next.js Standalone Build → packages/web/.next/standalone/
2. ZIP Creation → lace-standalone.zip
3. Bun Compilation → lace-standalone (executable)
```

### Key Components

**Next.js Configuration** (`packages/web/next.config.ts`)
- Configures `outputFileTracingIncludes` with required dependencies
- Sets `outputFileTracingRoot` to project root for proper path resolution

**Custom Server** (`packages/web/server-custom.ts`)
- Enhanced wrapper around Next.js `startServer`
- Automatic port detection (finds available port starting from 31337)
- Working directory management for standalone builds

**Build Scripts**
- `build`: Next.js build (Turbopack); use BUILD_STANDALONE=true for standalone
- `build:standalone`: Shorthand for standalone build
- `scripts/build-simple.ts`: ZIP creation and Bun compilation orchestration

## Usage

### Building the Executable

```bash
# Standalone build
bun run build:standalone

# Standard Next.js build (non-standalone)
bun run build
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
5. **Readiness Logging**: Logs the URL when the server is ready


## Build Artifacts

### Generated Files

- `lace-standalone`: Final executable (self-contained binary)
- `lace-standalone.zip`: Source archive embedded in executable
- `packages/web/.next/`: Next.js build artifacts

### ZIP Structure
```
standalone/
├── packages/web/           # Next.js app
│   ├── .next/             # Build artifacts
│   ├── server.ts          # Custom server
│   └── node_modules/      # App-specific dependencies
├── node_modules/          # Runtime dependencies
├── package.json           # Root package.json
└── ...                    # Other project files
```

## Troubleshooting

### Common Issues

**Missing Dependencies**
- Check Next.js build output for included dependencies
- Verify required packages are included in the build
- Look for module resolution errors in build logs

**Module Resolution Failures**
- Ensure server changes working directory to standalone root
- Check that dependencies are at `node_modules/...` not `packages/web/node_modules/...`
- Verify `outputFileTracingRoot` is set correctly


**Build Failures**
- Clear all caches: `rm -rf build packages/web/.next packages/web/server.js`
- Check TypeScript compilation errors
- Verify Bun is properly installed and updated

### Debug Commands

```bash
# Verify ZIP contents
unzip -l lace-standalone.zip | grep node_modules

# Clean build from scratch
rm -rf build packages/web/.next && bun run build:standalone
```

## Performance Considerations

- **Build Time**: Build process typically takes 30-90 seconds
- **ZIP Size**: Dependencies included in final executable
- **Startup Time**: Extraction to temp directory adds ~100ms
- **Memory**: Temporary extraction requires disk space (typically ~50MB)

## Future Improvements

- **Caching**: Improve build caching for faster incremental builds
- **Optimization**: Minimize dependency set in standalone builds
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


## Security Considerations

- Temporary extraction directory is created with secure permissions
- Extracted files are cleaned up on process exit
- No network dependencies required for runtime execution
- Self-contained execution prevents dependency confusion attacks