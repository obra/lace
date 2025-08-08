# Single-File Bun VFS + Next.js Debugging Plan

**Status**: Next.js fails during `app.prepare()` with path.join error - VFS module resolution works perfectly, but Next.js does direct filesystem operations

**Goal**: Complete pure VFS approach where Next.js runs entirely from embedded VFS with zero filesystem dependencies

## Current State

### ✅ What's Working
- **9,006 VFS files successfully embedded** (4,774 Next.js + 1,917 deps + 2,256 web assets)
- **VFS module resolution works perfectly** - all `require()` calls resolve correctly from VFS
- **Next.js module loading from VFS** - `const nextModule = this.resolver.loadModule('next')` works
- **Next.js app instance creation** - `nextModule({ dir, conf })` succeeds
- **Complex relative imports working** - paths like `../build/output/log` resolve correctly

### ❌ What's Failing
- **Next.js `app.prepare()` fails** with `setupFsCheck` path.join error
- **Direct filesystem operations** - Next.js bypasses VFS for filesystem validation
- **Hybrid approach problem** - UNACCEPTABLE: pointing Next.js to real `packages/web` directory instead of VFS

### 🔍 Root Cause Analysis
The error occurs because:
1. We point Next.js to real filesystem path: `dir: '/path/to/packages/web'`
2. Next.js does direct filesystem validation via `setupFsCheck()` function
3. These filesystem calls don't go through our `require()` patching
4. Next.js expects certain paths/files that cause path.join with undefined values

**Key Insight**: Our VFS module resolution is perfect - the problem is we're not using a pure VFS approach.

## Architecture Problem

### Current (Broken) Approach
```
Next.js Framework (VFS) + Lace App (Real Filesystem)
├── next/dist/server/next.js ← VFS ✅
├── packages/web/app/layout.tsx ← Real filesystem ❌
└── packages/web/next.config.ts ← Real filesystem ❌
```

### Target (Pure VFS) Approach
```
Everything in VFS Memory
├── next/dist/server/next.js ← VFS ✅
├── web-app/app/layout.tsx ← VFS (embedded packages/web)
├── web-app/next.config.ts ← VFS (embedded packages/web) 
└── web-app/.next/build-manifest.json ← VFS (embedded build)
```

## Debugging Strategy

### Phase 1: Understand Next.js Filesystem Expectations

**Objective**: Identify exactly what filesystem operations `setupFsCheck` is doing

**Tasks**:
1. **Create minimal reproduction**:
   ```bash
   # Test with verbose logging to capture exact error location
   ./build/executables/lace-standalone --verbose 2>&1 | grep -A 10 -B 10 "setupFsCheck"
   ```

2. **Examine Next.js source** for `setupFsCheck` function:
   - Check `next/dist/server/next.js` in our VFS
   - Find what filesystem paths it's validating
   - Identify what files/directories it expects

3. **Log filesystem calls**:
   ```typescript
   // Temporarily patch fs.existsSync, fs.readFileSync to log calls
   const originalExistsSync = fs.existsSync;
   fs.existsSync = (path) => {
     console.log(`🔍 fs.existsSync called with: "${path}"`);
     return originalExistsSync(path);
   };
   ```

**Expected Findings**:
- Next.js checks for project structure (`app/`, `pages/`, `.next/`)
- Next.js validates configuration files (`next.config.js`, `package.json`)
- Next.js expects build artifacts (`.next/build-manifest.json`, etc.)

### Phase 2: Embed Complete Lace Application in VFS

**Objective**: Move from hybrid approach to pure VFS with complete Lace app embedded

**Current VFS Structure**:
```
webAssetsVFS: 2,256 files (from packages/web/.next build output)
```

**Target VFS Structure**:
```
laceAppVFS: Complete packages/web directory including:
├── app/ (Next.js app router files)
├── components/ (React components)  
├── lib/ (utility functions)
├── next.config.ts (Next.js configuration)
├── package.json (project metadata)
├── .next/ (build artifacts)
└── tsconfig.json (TypeScript config)
```

**Implementation**:
1. **Generate Lace App VFS**:
   ```bash
   # Add to scripts/generate-vfs.ts
   bunx make-vfs \
     --dir packages/web \
     --extensions js,jsx,ts,tsx,json,css,md \
     --content-format string \
     --outfile src/vfs/lace-app.ts
   ```

2. **Update VFS Generator**:
   ```typescript
   // In src/vfs/generator.ts
   export interface VFSMaps {
     next: Record<string, string>;
     react: Record<string, string>;
     reactDom: Record<string, string>;
     deps: Record<string, string>;
     laceAssets: Record<string, string>;
     webAssets: Record<string, string>;
     laceApp: Record<string, string>; // ← Add this
   }
   ```

3. **Static import the new VFS**:
   ```typescript
   import laceAppVFS from './lace-app.js';
   ```

### Phase 3: VFS-Based Next.js Directory Structure

**Objective**: Create virtual project structure that Next.js can work with entirely in memory

**Problem**: Next.js expects `dir` parameter to be a real filesystem path, but we want pure VFS.

**Solution Approaches**:

#### Option A: VFS Path Mapping
```typescript
// Configure Next.js to use VFS paths
const nextApp = this.nextModule({
  dev: false,
  dir: 'vfs://lace-app/', // Virtual path
  customServer: true,
  conf: this.buildVFSNextConfig()
});
```

#### Option B: Temporary Directory Creation
```typescript
// Create minimal temp structure pointing to VFS
const tempDir = await this.createVFSProjectStructure();
const nextApp = this.nextModule({
  dir: tempDir, // Temp path with VFS symlinks/files
  conf: this.buildVFSNextConfig()
});
```

#### Option C: Next.js Configuration Override
```typescript
// Override Next.js internal filesystem expectations
const nextConfig = {
  ...userConfig,
  experimental: {
    useVirtualFileSystem: true, // If available
  },
  // Override internal paths to use VFS
  distDir: 'vfs://web-assets/.next',
  // etc.
};
```

### Phase 4: VFS Filesystem Operation Patching

**Objective**: If pure configuration doesn't work, intercept Next.js filesystem operations

**⚠️ Note**: This contradicts the "pure VFS" approach but may be necessary as fallback.

**Implementation**:
```typescript
class VFSFilesystemPatcher {
  patchFilesystemOperations(vfsMaps: VFSMaps) {
    const originalFs = {
      existsSync: fs.existsSync,
      readFileSync: fs.readFileSync,
      statSync: fs.statSync,
      readdirSync: fs.readdirSync
    };

    // Intercept filesystem calls and redirect to VFS
    fs.existsSync = (path: string) => {
      const vfsPath = this.mapRealPathToVFS(path);
      if (vfsPath && this.hasVFSFile(vfsPath, vfsMaps)) {
        console.log(`📁 fs.existsSync: ${path} → VFS:${vfsPath} ✅`);
        return true;
      }
      return originalFs.existsSync(path);
    };

    fs.readFileSync = (path: string, encoding?: string) => {
      const vfsPath = this.mapRealPathToVFS(path);
      const vfsContent = this.getVFSContent(vfsPath, vfsMaps);
      if (vfsContent) {
        console.log(`📄 fs.readFileSync: ${path} → VFS:${vfsPath}`);
        return encoding ? vfsContent : Buffer.from(vfsContent);
      }
      return originalFs.readFileSync(path, encoding as any);
    };

    // Similar for statSync, readdirSync, etc.
  }

  private mapRealPathToVFS(realPath: string): string | null {
    // Convert filesystem paths to VFS keys
    // e.g., "/tmp/packages/web/app/layout.tsx" → "app/layout.tsx"
    if (realPath.includes('packages/web/')) {
      return realPath.split('packages/web/')[1];
    }
    return null;
  }
}
```

## Implementation Plan

### Week 1: Investigation & Setup
- [ ] **Day 1-2**: Phase 1 - Debug Next.js filesystem expectations
- [ ] **Day 3-4**: Phase 2 - Embed complete Lace app in VFS  
- [ ] **Day 5**: Test VFS generation and validate file coverage

### Week 2: VFS Integration
- [ ] **Day 1-2**: Phase 3 - Implement VFS-based directory structure
- [ ] **Day 3-4**: Test different Next.js configuration approaches
- [ ] **Day 5**: Phase 4 - Implement filesystem patching if needed

### Week 3: Testing & Refinement
- [ ] **Day 1-2**: End-to-end testing of pure VFS approach
- [ ] **Day 3-4**: Performance optimization and error handling
- [ ] **Day 5**: Documentation and deployment testing

## Success Criteria

### Technical Metrics
- [ ] **Pure VFS**: Zero real filesystem dependencies during runtime
- [ ] **Next.js Preparation**: `app.prepare()` completes without errors
- [ ] **HTTP Responses**: Server responds to requests with Next.js-rendered content
- [ ] **Complete Functionality**: All Lace features work from single executable

### Architecture Validation
- [ ] **No Filesystem Calls**: All `fs.*` operations serve from VFS
- [ ] **Memory-Only Operation**: Executable runs without extracting files
- [ ] **Single File Distribution**: True single-file with embedded framework + app

## Key Files to Modify

### Core VFS System
- `src/vfs/generator.ts` - Add Lace app VFS generation
- `src/vfs/next-loader.ts` - Update to use pure VFS directory
- `src/vfs/module-resolver.ts` - Handle app-specific module resolution

### Build System  
- `scripts/generate-vfs.ts` - Add Lace app VFS generation
- `scripts/build-executable.ts` - Validate VFS completeness

### Configuration
- `src/vfs/next-loader.ts` - VFS-aware Next.js configuration
- `build/lace-standalone.ts` - Entry point validation

## Expected Challenges

### Challenge 1: Next.js Build Artifacts
**Problem**: Next.js expects `.next/` directory with build-time artifacts
**Solution**: Include complete build output in VFS or generate minimal required files

### Challenge 2: Dynamic Path Resolution
**Problem**: Next.js uses dynamic path construction that may break in VFS
**Solution**: Pre-compute all possible paths and include in VFS registry

### Challenge 3: Asset Loading
**Problem**: Next.js static assets may use filesystem-based serving
**Solution**: Custom asset handler that serves from VFS

## Testing Strategy

### Unit Tests
```bash
# Test VFS generation
npm run test src/vfs/generator.test.ts

# Test Next.js loading
npm run test src/vfs/next-loader.test.ts
```

### Integration Tests  
```bash
# Test complete VFS system
./build/executables/lace-standalone --test-mode

# Test with real HTTP requests
curl http://localhost:3000/
```

### Performance Tests
```bash
# Startup time
time ./build/executables/lace-standalone &

# Memory usage
ps aux | grep lace-standalone
```

## Debugging Commands

### VFS Content Inspection
```bash
# Check VFS file counts
./build/executables/lace-standalone --vfs-debug

# List VFS registry entries
grep "registry entries" logs.txt
```

### Next.js Error Analysis
```bash
# Capture detailed Next.js logs
./build/executables/lace-standalone --verbose 2>&1 | tee debug.log

# Focus on filesystem operations
grep -E "(fs\.|path\.)" debug.log
```

### Build Validation
```bash
# Verify VFS generation
ls -la src/vfs/*.ts
wc -l src/vfs/*.ts

# Test executable compilation
bun scripts/build-executable.ts --debug
```

## Handoff Checklist

### Understanding Required
- [ ] **Bun VFS System**: How `make-vfs` embeds files in executables
- [ ] **Next.js Architecture**: Server-side rendering and filesystem expectations  
- [ ] **Module Resolution**: How Node.js `require()` and ES imports work
- [ ] **Pure VFS Approach**: Why we avoid filesystem operations entirely

### Tools Needed
- [ ] **Bun**: Runtime and compilation toolchain
- [ ] **Next.js Knowledge**: Understanding of Next.js internals
- [ ] **Node.js Debugging**: Ability to trace filesystem calls
- [ ] **TypeScript**: Strong typing and module system understanding

### Context Files
- [ ] Read `docs/research/single-file-executable.md` - Complete technical background
- [ ] Review `src/vfs/` directory - Current VFS implementation
- [ ] Examine `clean-test/vfs-custom-server.ts` - Working VFS prototype
- [ ] Study build logs from `./build/executables/lace-standalone --verbose`

---

**Next Actions**: Start with Phase 1 debugging to understand exactly what Next.js filesystem operations are failing, then move to embedding complete Lace app in VFS for pure memory-based operation.

**Success Definition**: When `./lace-standalone` starts a working Next.js server serving Lace interface with zero files extracted to disk and zero filesystem dependencies.
