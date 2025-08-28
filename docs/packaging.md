# Packaging and Distribution

## Overview

Lace uses a clean Bun compilation system to create standalone executables with embedded assets. This eliminates file extraction, temporary directories, and runtime dependencies.

## Build System

### Prerequisites

- **Bun 1.2.21+** - Required for asset embedding and `Bun.embeddedFiles` API (enforced via package.json "engines")
- **macOS** (for signed app bundles)
- **Xcode** (for Swift menu bar app compilation)

### Build Targets

#### Standalone Executable
```bash
npm run build:macos              # Creates ./build/Lace
npm run build:macos:signed       # Creates signed ./build/Lace
```

#### macOS App Bundle
```bash
npm run build:macos:app          # Creates ./build/Lace.app
npm run build:macos:app:signed   # Creates signed ./build/Lace.app for distribution
```

## Architecture

### Dynamic File Embedding

The build system uses dynamic import generation to embed all required files:

1. **Scan phase**: `scripts/generate-all-imports.ts` discovers all JSON/MD files
2. **Import generation**: Creates `build/temp/embed-all-files.ts` with explicit imports  
3. **Compilation**: Bun embeds all files using `with { type: 'file' }` imports
4. **Runtime access**: `loadFilesFromDirectory()` uses `Bun.embeddedFiles` for discovery

### Embedded Files

- **Provider Catalogs** (JSON): 13 files from `packages/core/src/providers/catalog/data/`
- **Prompt Templates** (MD): 11 files from `packages/core/src/config/prompts/`
- **Web Assets**: All React Router client files (CSS, JS, fonts)

### File Loading Strategy

```typescript
// Embedded mode (Bun executable)
if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
  // Load from embedded files by path matching
}

// Development mode (Node.js)  
else {
  // Load from file system
}
```

## Build Process

### 1. React Router Build
```bash
npm run build --workspace=packages/web
```
Creates `packages/web/build/` with client and server bundles.

### 2. Import Generation
```bash
bun scripts/generate-all-imports.ts
```
Scans directories and generates `build/temp/embed-all-files.ts` with explicit imports for all JSON and MD files.

### 3. Compilation
```bash
bun build --compile --target=bun-darwin-arm64 build/temp/embed-all-files.ts
```
Creates standalone executable with all assets embedded.

### 4. App Bundle (Optional)
- Compiles Swift menu bar app from `platforms/macos/`
- Creates `.app` bundle structure  
- Embeds server as `lace-server` binary
- Adds Info.plist and app icon

### 5. Signing (Optional)
Uses `scripts/sign-and-notarize.ts` for full code signing and notarization.

## Technical Details

### Resource Resolution

The resource resolver detects execution context:

- **Bun executable**: `import.meta.url` contains `$bunfs` → use embedded files
- **Development**: Standard file system paths → use directory loading
- **Bundled**: React Router build paths → map to source locations

### Node.js Compatibility

All code maintains Node.js compatibility:
- `typeof Bun !== 'undefined'` guards for Bun-specific APIs
- Graceful fallback to file system loading
- No Bun-only dependencies in core logic

### Generated Files

All generated files are placed in `build/temp/` and gitignored:
- `build/temp/embed-all-files.ts` - Import file for embedding
- `build/temp/generated-client-assets.ts` - Web asset imports (if used)

## Distribution

### Standalone Executable

The `./build/Lace` executable is fully self-contained:
- 70MB file with all assets embedded
- No installation or setup required  
- Copy to any compatible system and run
- Zero external dependencies

### macOS App Bundle

The `./build/Lace.app` bundle includes:
- Swift menu bar application
- Embedded Lace server binary
- App icon and metadata
- Ready for App Store or direct distribution

### Cross-Platform

The build system supports cross-compilation:
```bash
bun scripts/build-macos-app.ts --target bun-linux-x64 --name lace-linux
bun scripts/build-macos-app.ts --target bun-windows-x64 --name lace-windows
```

## Deployment

### Development Testing
```bash
npm run build:macos        # Build executable
./build/Lace --port 8080   # Test locally
```

### Production Distribution
```bash
npm run build:macos:app:signed   # Build signed app bundle
open ./build/Lace.app            # Test app bundle
```

The signed app bundle is ready for distribution through any channel.

## Comparison to Legacy System

### Before (ZIP Extraction)
- ❌ Complex ZIP file creation with temp directory organization
- ❌ Runtime extraction to `tmpdir()` on every startup
- ❌ File system dependencies and cleanup logic
- ❌ 4.2MB generated VFS files committed to git

### After (Clean Bun Compilation)
- ✅ Dynamic file discovery at build time
- ✅ Clean asset embedding with preserved directory structure  
- ✅ Zero runtime dependencies or file extraction
- ✅ Production-ready with all provider catalogs working

The new system is dramatically simpler, more reliable, and truly standalone.