# Lace Packaging Guide

This document describes how to create and operate the Bun-based single-file packaging system for Lace.

## Overview

The Lace packaging system creates a completely self-contained executable that includes:
- Complete Next.js web application
- All Node.js dependencies  
- Production build assets
- Database and configuration

The executable extracts itself to a temporary directory and runs the full Lace server.

## Quick Start

```bash
# 1. Build the Next.js application
cd packages/web && bun run build

# 2. Create the single-file executable
bun run scripts/build-simple.ts

# 3. Run the executable
./build/lace-standalone --port 3000
```

## Build Process

### Prerequisites

- **Bun latest** - Required for compilation and bundling
- **Node.js 20+** - For Next.js build process
- **zip command** - Standard system utility for creating archives

### Step-by-Step Build

#### 1. Prepare the Next.js Build

```bash
cd packages/web
bun run build
```

This creates the production-ready Next.js build in `packages/web/.next/` including:
- Optimized JavaScript bundles
- Static assets and pages
- Server-side rendering components
- Build manifest and metadata

#### 2. Run the Packaging Script

```bash
# From project root
bun run scripts/build-simple.ts
```

The build script performs these operations:

1. **Validation** - Checks that Next.js build exists
2. **ZIP Creation** - Packages entire `packages/web` directory
3. **Bun Compilation** - Creates executable with embedded ZIP
4. **Testing** - Verifies executable works correctly

#### 3. Build Output

```
build/
├── lace-project.zip      # ~200-300MB ZIP of packages/web
└── lace-standalone       # ~500MB executable
```

## Runtime Behavior

### Startup Process

When you run the executable:

1. **Extraction** - ZIP is extracted to `/tmp/lace-{timestamp}-{pid}/`
2. **Environment Setup** - Sets `NODE_ENV=production` and working directory
3. **Server Start** - Imports and runs `packages/web/server.js`
4. **Ready** - Lace web interface available at specified port

### Example Output

```
🚀 Starting Lace single-file server...
📦 Extracting standalone build...
📁 Extracting to: /tmp/lace-1692025234567-12345
📁 Lace project extracted (includes all dependencies)
✅ Standalone build extracted
🌐 Starting Lace server...
📁 Running from: /tmp/lace-1692025234567-12345/packages/web
Server ready on http://127.0.0.1:3000
```

### Cleanup

The executable automatically cleans up temporary files when:
- Process receives SIGINT (Ctrl+C)
- Process receives SIGTERM
- Process exits normally

## Usage Options

### Command Line Arguments

```bash
./build/lace-standalone [options]

Options:
  --port, -p <port>    Server port (default: 3000)
  --host, -h <host>    Server host (default: 127.0.0.1)
  --verbose, -v        Enable verbose logging
  --help               Show help message
```

### Examples

```bash
# Default settings (port 3000, localhost)
./build/lace-standalone

# Custom port
./build/lace-standalone --port 8080

# Listen on all interfaces
./build/lace-standalone --host 0.0.0.0 --port 3000

# Verbose logging
./build/lace-standalone --verbose
```

## Build Customization

### Target Platform

The build script currently targets `bun-darwin-arm64`. To build for other platforms:

```bash
# Edit scripts/build-simple.ts line 51:
const compileCmd = `bun build ${execSourcePath} --compile --outfile=${outputPath} --target=bun-linux-x64 --minify`;
```

Available targets:
- `bun-darwin-arm64` - macOS Apple Silicon
- `bun-darwin-x64` - macOS Intel
- `bun-linux-x64` - Linux x86_64
- `bun-linux-arm64` - Linux ARM64

### Build Size Optimization

Current build includes all dependencies (~500MB). To reduce size:

1. **Remove Development Dependencies**
   ```bash
   # Before zipping, remove dev dependencies
   cd packages/web && npm prune --production
   ```

2. **Exclude Unnecessary Files**
   ```bash
   # Modify ZIP creation in build-simple.ts
   execSync(`zip -r ${zipPath} packages/web -x "*.test.*" "*.spec.*" "node_modules/.cache/*"`, {
     stdio: 'pipe',
   });
   ```

3. **Use Compression**
   ```bash
   # Add compression to ZIP creation
   execSync(`zip -r9 ${zipPath} packages/web -q`, {
     stdio: 'pipe',
   });
   ```

## Troubleshooting

### Build Issues

**Error: Next.js build not found**
```bash
cd packages/web && bun run build
```

**Error: bun command not found**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Error: zip command not found**
- **macOS**: Install via Xcode Command Line Tools
- **Ubuntu/Debian**: `sudo apt-get install zip`
- **CentOS/RHEL**: `sudo yum install zip`

### Runtime Issues

**Error: Permission denied**
```bash
chmod +x ./build/lace-standalone
```

**Error: Port already in use**
```bash
./build/lace-standalone --port 3001
```

**Error: Cannot write to temp directory**
- Check disk space in `/tmp`
- Verify write permissions for user

### Debugging

**Verbose Output**
```bash
./build/lace-standalone --verbose
```

**Manual Extraction (for debugging)**
```bash
# Extract ZIP manually to inspect contents
mkdir debug-extract
cd debug-extract
unzip ../build/lace-project.zip
ls -la packages/web/
```

## Performance Characteristics

### Build Time
- Next.js build: 30-90 seconds
- ZIP creation: 5-15 seconds  
- Bun compilation: 10-30 seconds
- **Total**: 1-3 minutes

### Runtime Performance
- **Startup time**: 3-5 seconds (mainly extraction)
- **Memory usage**: 100-200MB (standard Next.js footprint)
- **Disk usage**: 200-400MB temporary files during runtime

### File Sizes
- ZIP archive: 200-300MB
- Final executable: 400-500MB
- Temporary extraction: 200-300MB

## Architecture Notes

### Why This Approach

1. **Simplicity** - No complex VFS or filesystem patching
2. **Reliability** - Uses standard extraction + execution
3. **Bun Compatibility** - Leverages Bun's strengths without fighting limitations
4. **Production Ready** - Uses actual production builds with proper manifests

### Technical Details

- **ZIP Embedding** - Uses Bun's `import ... with { type: 'file' }` for binary embedding
- **Extraction** - Standard unzip to temporary directory
- **Execution** - Changes working directory and imports actual server
- **Cleanup** - Signal handlers ensure temporary files are removed

### Future Improvements

1. **Extraction Caching** - Cache extracted files between runs
2. **Selective Packaging** - Only include production-necessary files  
3. **Compression** - Better compression algorithms
4. **Multi-Platform** - Automated builds for all target platforms

This packaging system provides a robust foundation for distributing Lace as a true single-file application while maintaining simplicity and reliability.