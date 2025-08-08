# Single-File Executable Build System

This document describes the complete build pipeline for creating standalone Lace executables with embedded VFS (Virtual File System).

## Overview

The single-file executable system allows Lace to run as a completely standalone binary with:

- **Embedded Next.js framework** (4,774+ files)
- **React and React DOM libraries** (348 files combined)
- **All Lace configuration and prompts** (11+ files)
- **Complete web application assets** (2,256+ files)
- **Zero external dependencies** at runtime

Total embedded files: **~7,148 files** creating a true single-file distribution.

## Build Pipeline Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   TypeScript    │    │   Web Assets    │    │  Lace Config    │
│     Build       │───▶│     Build       │───▶│    Assets       │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VFS Generation                               │
│  • next-complete.ts (81MB)   • react.ts (340KB)               │
│  • web-assets.ts (44MB)      • react-dom.ts (5.5MB)           │
│  • lace-assets.ts (24KB)     • next-deps.ts (164KB)           │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Production Server Integration                   │
│  • VFS Module Resolver      • Next.js VFS Loader              │
│  • Filesystem Patcher       • Production Server              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Bun Executable Compilation                   │
│  Target: bun-linux-x64 | bun-darwin-arm64 | etc.              │
│  Output: Single executable file (~50-100MB)                    │
└─────────────────────────────────────────────────────────────────┘
```

## Build Scripts

### Core Build Scripts

1. **`scripts/build-vfs.ts`** - VFS Generation Pipeline
   - Validates build environment
   - Generates all VFS files using make-vfs
   - Validates VFS integrity
   - Provides comprehensive build reporting

2. **`scripts/build-executable.ts`** - Executable Compilation
   - Creates executable entry point
   - Compiles with Bun for target platform
   - Tests executable functionality
   - Generates compilation reports

### Package.json Scripts

```bash
# VFS Generation
npm run build:vfs              # Generate VFS files
npm run build:vfs:clean        # Clean build VFS files  
npm run build:vfs:verbose      # Verbose VFS generation

# Executable Compilation
npm run build:executable       # Build executable (default platform)
npm run build:executable:linux # Build for Linux x64
npm run build:executable:verbose # Verbose executable build
```

### Makefile Targets

```bash
# Quick Development
make install                   # Install all dependencies
make build-deps               # Build TypeScript + Web only
make build-vfs                # Generate VFS files only
make quick                    # Fast dev build (no executable)

# Full Build Pipeline  
make build                    # Complete build pipeline
make build TARGET=bun-linux-x64 # Platform-specific build
make test-executable          # Test compiled executable

# Multi-Platform Distribution
make dist                     # Build for all platforms
make release                  # Create release packages
make linux                   # Linux-specific build
make macos                   # macOS ARM build
make macos-intel             # macOS Intel build

# Maintenance
make clean                   # Clean all build artifacts
make validate                # Validate build environment
make benchmark              # Benchmark executable performance
```

## Build Environment Requirements

### Prerequisites
- **Node.js 20+** - Runtime and build tools
- **Bun latest** - Executable compilation (install from https://bun.sh)
- **npm** - Package management
- **make** - Build orchestration (optional but recommended)

### Platform Support
- **macOS ARM64** (Apple Silicon) - `bun-darwin-arm64`
- **macOS x64** (Intel) - `bun-darwin-x64`  
- **Linux x64** - `bun-linux-x64`
- **Linux ARM64** - `bun-linux-arm64`
- **Windows x64** - `bun-windows-x64` (experimental)

## VFS System Architecture

### Generated VFS Files (Not Committed)

These files are generated during build and should not be committed to git:

```bash
src/vfs/next-complete.ts    # 81MB  - Complete Next.js framework
src/vfs/web-assets.ts      # 44MB  - Web application assets  
src/vfs/react-dom.ts       # 5.5MB - React DOM library
src/vfs/react.ts           # 340KB - React library
src/vfs/next-deps.ts       # 164KB - Next.js dependencies
src/vfs/lace-assets.ts     # 24KB  - Lace configuration files
```

### Source Code Files (Committed)

```bash
src/vfs/generator.ts          # VFS generation orchestration
src/vfs/module-resolver.ts    # CommonJS module resolution
src/vfs/fs-patcher.ts        # Filesystem interception
src/vfs/next-loader.ts       # Next.js VFS integration
src/vfs/production-server.ts # Unified production server
```

## Build Process Details

### Phase 1: Environment Validation
- Check Node.js version (≥20)
- Verify TypeScript build exists
- Confirm web build exists
- Validate dependencies installed
- Test make-vfs tool availability

### Phase 2: Dependency Building
- Compile TypeScript to `dist/`
- Copy configuration files
- Build Next.js web application
- Generate optimized production assets

### Phase 3: VFS Generation
- Extract Next.js framework files using make-vfs
- Embed React and React DOM libraries
- Include Lace configuration and prompts
- Package web application assets
- Create VFS module registry (4,881 modules)
- Build asset registry (2,267 files)

### Phase 4: Production Server Integration
- Initialize VFS module resolver
- Setup filesystem patching for assets  
- Configure Next.js VFS loader
- Create unified production server

### Phase 5: Executable Compilation
- Generate standalone entry point
- Compile with Bun for target platform
- Minify and optimize executable
- Test executable functionality

## Usage Examples

### Development Workflow

```bash
# Initial setup
make install
make validate

# Development build (fast)
make quick

# Full build and test
make build
make test-executable

# Clean rebuild
make clean build
```

### Multi-Platform Release

```bash
# Build for all platforms
make dist

# Results in build/dist/:
# lace-macos-arm64.tar.gz
# lace-macos-x64.tar.gz  
# lace-linux-x64.tar.gz
# lace-linux-arm64.tar.gz
```

### CI/CD Integration

The build system includes GitHub Actions workflow (`.github/workflows/build-executable.yml`) that:

1. **Tests VFS system** on Ubuntu
2. **Builds executables** for all platforms in parallel
3. **Tests executables** with startup and help commands
4. **Creates release artifacts** for tagged commits
5. **Uploads release assets** automatically

### Custom Builds

```bash
# Custom name and output directory
make build NAME=my-lace OUTDIR=custom/dir

# Verbose build with debugging
make build VERBOSE=1

# Development build without minification
npx tsx scripts/build-executable.ts --no-minify --sourcemap
```

## Performance Characteristics

### Build Times
- **VFS Generation**: ~30-60 seconds
- **Executable Compilation**: ~15-30 seconds  
- **Total Build Time**: ~1-2 minutes

### Executable Size
- **Typical size**: 50-100MB
- **Contains**: 7,148+ embedded files
- **Startup time**: ~1-3 seconds
- **Memory usage**: ~50-100MB initial

### VFS Performance
- **Module resolution**: <1ms per module
- **Asset serving**: <1ms per asset
- **Filesystem patching**: Transparent overhead
- **Next.js startup**: ~2-5 seconds

## Troubleshooting

### Common Issues

1. **"make-vfs not found"**
   ```bash
   # Install Bun first
   curl -fsSL https://bun.sh/install | bash
   ```

2. **"Environment validation failed"**
   ```bash
   # Run validation to see specific issues
   make validate
   ```

3. **"VFS generation failed"**
   ```bash
   # Clean and rebuild dependencies
   make clean build-deps build-vfs
   ```

4. **"Executable too large"**
   ```bash
   # Build without minification to debug
   npx tsx scripts/build-executable.ts --no-minify
   ```

### Debug Options

```bash
# Verbose VFS generation
npm run build:vfs:verbose

# Verbose executable compilation  
npm run build:executable:verbose

# Test individual components
make test-vfs
npx tsx scripts/test-production-server.ts
```

## Architecture Benefits

### Complete Isolation
- **No external dependencies** at runtime
- **No installation required** - just download and run  
- **No Node.js required** on target machine
- **Self-contained web server** with embedded assets

### Distribution Advantages
- **Single file distribution** - easy deployment
- **Cross-platform support** - build once, run anywhere
- **Version consistency** - no dependency conflicts
- **Offline operation** - all assets embedded

### Development Benefits  
- **Fast builds** with intelligent caching
- **Comprehensive testing** throughout pipeline
- **Multi-platform CI/CD** with automatic releases
- **Detailed reporting** and error diagnostics

This build system represents a complete solution for creating truly standalone, self-contained Lace executables that can run anywhere without external dependencies.

## Bun-Native Simple Bundle Approach (2025-08-14)

After encountering circular dependency issues and stack overflow problems with the complex VFS system, we developed a simpler, more reliable approach using Bun's native capabilities.

### Problem with VFS Approach

The original VFS system created several issues:

1. **Stack Overflow**: The 278MB VFS files (`lace-app.ts`) contained circular dependencies that caused infinite recursion in Bun's module loader
2. **Complex Patching**: Filesystem patching with `Module.prototype.require` manipulation was brittle and caused recursion loops
3. **Memory Issues**: Converting large files to base64 strings hit JavaScript's string length limits (>536MB strings)
4. **Build Complexity**: The VFS generation was slow and error-prone with multiple interdependent steps

### Bun-Native Solution

The new approach leverages Bun's strengths directly:

#### Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Production    │    │   ZIP Entire    │    │  Bun Bundle     │
│   Next.js       │───▶│   packages/web  │───▶│  with Native    │
│   Build         │    │   Directory     │    │  File Import    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Runtime Process                              │
│  1. Extract ZIP to temp directory                              │
│  2. Run packages/web/server.ts with Bun                       │
│  3. Use Bun's native SQLite + HTTP server                     │
│  4. Cleanup temp directory on exit                            │
└─────────────────────────────────────────────────────────────────┘
```

#### Implementation Files

**Build Scripts:**
- `scripts/simple-bundle.ts` - Server executable that extracts and runs
- `scripts/build-simple.ts` - Build orchestration using Bun's file bundling

#### Key Technical Decisions

1. **No Base64 Encoding**: Use Bun's `import ... with { type: 'file' }` to bundle ZIP as binary data
2. **Full Project Packaging**: Include entire `packages/web` directory with node_modules (no artificial trimming)
3. **Bun File API**: Use `Bun.file().arrayBuffer()` to access bundled ZIP data
4. **Native Server**: Run the actual `packages/web/server.ts` instead of custom server
5. **Production Build**: Ensure `BUILD_ID` and proper Next.js production files exist

#### Build Process

```bash
# 1. Create production Next.js build
cd packages/web && bun run build

# 2. ZIP complete project (no trimming for testing phase)
zip -r build/lace-project.zip packages/web -q

# 3. Bundle with Bun's native file import
bun build scripts/simple-bundle.ts --compile --outfile=build/lace-standalone

# Result: ~500MB executable (includes full node_modules)
```

#### Runtime Process

```typescript
// Extract bundled ZIP
const zipFile = Bun.file(zipData);
const zipBuffer = await zipFile.arrayBuffer();
require('fs').writeFileSync(zipPath, new Uint8Array(zipBuffer));

// Extract to temp directory
execSync(`cd "${tempDir}" && unzip -q lace-project.zip`);

// Run actual Lace server
process.chdir(join(tempDir, 'packages', 'web'));
await import(join(tempDir, 'packages', 'web', 'server.js'));
```

### Advantages of Bun-Native Approach

1. **Simplicity**: No complex VFS system or filesystem patching
2. **Reliability**: Uses standard extraction + execution, no circular dependencies
3. **Bun Compatibility**: Leverages Bun's Node.js compatibility without fighting it
4. **Self-Contained**: True single-file executable with zero runtime dependencies
5. **Production Ready**: Uses actual production builds with proper BUILD_ID files
6. **Debugging**: Easy to debug since it's just extraction + server start

### Performance Characteristics

- **Executable Size**: ~500MB (full project with dependencies)
- **Startup Time**: 3-5 seconds (mainly extraction time)
- **Memory Usage**: Standard Next.js + Bun memory footprint
- **First Run**: Slower due to extraction, subsequent runs could be optimized with caching

### Future Optimizations

1. **Dependency Trimming**: Remove dev dependencies and test files from ZIP
2. **Extraction Caching**: Cache extracted files between runs
3. **Compression**: Use better compression for the embedded ZIP
4. **Selective Bundling**: Only include production-necessary files

### Build Commands

```bash
# Build the simple executable
bun run scripts/build-simple.ts

# Run the executable
./build/lace-standalone --port 3001

# The executable includes:
# - Complete packages/web directory
# - All node_modules dependencies  
# - Proper Next.js production build
# - BUILD_ID and manifest files
```

### Lessons Learned

1. **Bun's Strengths**: File bundling and Node.js compatibility work great together
2. **Avoid Over-Engineering**: Simple ZIP extraction is more reliable than complex VFS
3. **String Length Limits**: Large base64 strings hit JavaScript limits (>536MB)
4. **Production Builds**: Always use `bun run build` for proper Next.js production files
5. **Module Resolution**: Let Bun handle module resolution instead of custom patching

This Bun-native approach provides a working foundation for single-file Lace distribution that's simpler, more reliable, and leverages Bun's native capabilities effectively.