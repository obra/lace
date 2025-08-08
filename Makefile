# Lace Single-File Executable Build Pipeline
# Comprehensive build system for VFS-based standalone Lace executable

.PHONY: help install clean build build-vfs build-executable test-vfs test-executable dist release

# Default target
help:
	@echo "Lace Single-File Executable Build Pipeline"
	@echo ""
	@echo "Targets:"
	@echo "  help              Show this help message"
	@echo "  install          Install all dependencies"
	@echo "  clean            Clean build artifacts"
	@echo "  build            Full build pipeline (dependencies + VFS + executable)"
	@echo "  build-deps       Build project dependencies only"
	@echo "  build-vfs        Generate VFS files"
	@echo "  build-executable Compile single-file executable"
	@echo "  test-vfs         Test VFS functionality"
	@echo "  test-executable  Test compiled executable"
	@echo "  dist             Create distribution packages"
	@echo "  release          Build for all platforms"
	@echo ""
	@echo "Environment Variables:"
	@echo "  TARGET           Target platform (default: bun-darwin-arm64)"
	@echo "  NAME             Executable name (default: lace-standalone)"
	@echo "  OUTDIR           Output directory (default: build/executables)"
	@echo "  VERBOSE          Enable verbose output (1 or 0)"
	@echo ""
	@echo "Examples:"
	@echo "  make build                    # Full build"
	@echo "  make build TARGET=bun-linux-x64  # Linux build"
	@echo "  make build VERBOSE=1          # Verbose build"
	@echo "  make release                  # Multi-platform build"

# Environment variables with defaults
TARGET ?= bun-darwin-arm64
NAME ?= lace-standalone
OUTDIR ?= build/executables
VERBOSE ?= 0

# Build flags based on environment
VERBOSE_FLAG = $(if $(filter 1,$(VERBOSE)),--verbose,)
TARGET_FLAG = --target=$(TARGET)
NAME_FLAG = --name=$(NAME)
OUTDIR_FLAG = --outdir=$(OUTDIR)

# Install all dependencies
install:
	@echo "📦 Installing dependencies..."
	npm install
	@echo "🌐 Installing web dependencies..."
	cd packages/web && npm install
	@echo "✅ All dependencies installed"

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf build/
	rm -rf dist/
	rm -rf src/vfs/next-complete.ts
	rm -rf src/vfs/web-assets.ts
	rm -rf src/vfs/react-dom.ts
	rm -rf src/vfs/react.ts
	rm -rf src/vfs/next-deps.ts
	rm -rf src/vfs/lace-assets.ts
	@echo "✅ Build artifacts cleaned"

# Build project dependencies (TypeScript + Web)
build-deps:
	@echo "🔧 Building project dependencies..."
	npm run build
	@echo "✅ Dependencies built"

# Generate VFS files
build-vfs: build-deps
	@echo "📦 Generating VFS files..."
	npm run build:vfs $(if $(filter 1,$(VERBOSE)),-- --verbose,)
	@echo "✅ VFS files generated"

# Compile single-file executable
build-executable: build-vfs
	@echo "🔨 Compiling single-file executable..."
	npx tsx scripts/build-executable.ts $(TARGET_FLAG) $(NAME_FLAG) $(OUTDIR_FLAG) $(VERBOSE_FLAG)
	@echo "✅ Executable compiled"

# Full build pipeline
build: build-executable

# Test VFS functionality
test-vfs:
	@echo "🧪 Testing VFS functionality..."
	npx tsx scripts/test-vfs-resolver.ts
	npx tsx scripts/test-next-vfs-loader.ts
	npx tsx scripts/test-asset-vfs.ts
	@echo "✅ VFS tests completed"

# Test compiled executable
test-executable: build-executable
	@echo "🧪 Testing compiled executable..."
	@if [ -f "$(OUTDIR)/$(NAME)" ]; then \
		echo "📋 Executable info:"; \
		ls -lh "$(OUTDIR)/$(NAME)"; \
		echo "🏃 Testing help command:"; \
		"$(OUTDIR)/$(NAME)" --help; \
		echo "✅ Executable tests passed"; \
	else \
		echo "❌ Executable not found: $(OUTDIR)/$(NAME)"; \
		exit 1; \
	fi

# Create distribution packages
dist: clean
	@echo "📦 Creating distribution packages..."
	mkdir -p build/dist
	
	# Build for multiple platforms
	$(MAKE) build TARGET=bun-darwin-arm64 NAME=lace-macos-arm64 OUTDIR=build/dist
	$(MAKE) build TARGET=bun-darwin-x64 NAME=lace-macos-x64 OUTDIR=build/dist
	$(MAKE) build TARGET=bun-linux-x64 NAME=lace-linux-x64 OUTDIR=build/dist
	$(MAKE) build TARGET=bun-linux-arm64 NAME=lace-linux-arm64 OUTDIR=build/dist
	
	# Create archives
	cd build/dist && tar -czf lace-macos-arm64.tar.gz lace-macos-arm64
	cd build/dist && tar -czf lace-macos-x64.tar.gz lace-macos-x64  
	cd build/dist && tar -czf lace-linux-x64.tar.gz lace-linux-x64
	cd build/dist && tar -czf lace-linux-arm64.tar.gz lace-linux-arm64
	
	@echo "✅ Distribution packages created in build/dist/"

# Release build (all platforms)
release: dist
	@echo "🚀 Release build completed"
	@echo "📊 Build summary:"
	@ls -lh build/dist/

# Development targets
dev-build: build-deps build-vfs
	@echo "🔧 Development build completed (no executable)"

dev-test: test-vfs
	@echo "🧪 Development tests completed"

# Platform-specific targets
linux: clean
	$(MAKE) build TARGET=bun-linux-x64

macos: clean  
	$(MAKE) build TARGET=bun-darwin-arm64

macos-intel: clean
	$(MAKE) build TARGET=bun-darwin-x64

# Validation targets
validate:
	@echo "✅ Validating build environment..."
	@node --version
	@npm --version
	@bun --version || echo "⚠️  Bun not found - install from https://bun.sh"
	@echo "📋 Environment validated"

# Benchmark target
benchmark: build-executable
	@echo "⏱️  Benchmarking executable..."
	@if [ -f "$(OUTDIR)/$(NAME)" ]; then \
		echo "📊 Executable size:"; \
		du -h "$(OUTDIR)/$(NAME)"; \
		echo "🏃 Startup benchmark:"; \
		time "$(OUTDIR)/$(NAME)" --help > /dev/null; \
	fi

# Quick targets for common workflows
quick: build-deps build-vfs
	@echo "⚡ Quick build completed (VFS only)"

full: clean build test-executable
	@echo "🎉 Full build and test pipeline completed"