# Build Lace menu bar app with Sparkle auto-update support
.PHONY: build clean test test-swift setup-sparkle generate-keys

APP_NAME = Lace
BUILD_DIR = build
APP_BUNDLE = $(BUILD_DIR)/$(APP_NAME).app
CONTENTS_DIR = $(APP_BUNDLE)/Contents
MACOS_DIR = $(CONTENTS_DIR)/MacOS
RESOURCES_DIR = $(CONTENTS_DIR)/Resources
TEST_DIR = $(BUILD_DIR)/tests
FRAMEWORKS_DIR = $(CONTENTS_DIR)/Frameworks
SPARKLE_FRAMEWORK = Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework

build: $(APP_BUNDLE)

setup-sparkle:
	@echo "Setting up Sparkle framework..."
	@if [ ! -d "$(SPARKLE_FRAMEWORK)" ]; then \
		echo "Error: Sparkle framework not found. Run 'make download-sparkle' first"; \
		exit 1; \
	fi

generate-keys:
	@echo "Generating EdDSA keys for Sparkle..."
	@if [ ! -f "sparkle_private_key" ]; then \
		./bin/generate_keys; \
		echo "Keys generated: sparkle_private_key and sparkle_public_key"; \
		echo "Add sparkle_public_key to your Info.plist SUPublicEDKey!"; \
	else \
		echo "Keys already exist"; \
	fi

download-sparkle:
	@echo "Downloading Sparkle framework..."
	@if [ ! -f "Sparkle.zip" ]; then \
		curl -L https://github.com/sparkle-project/Sparkle/releases/latest/download/Sparkle-for-Swift-Package-Manager.zip -o Sparkle.zip; \
	fi
	@if [ ! -d "$(SPARKLE_FRAMEWORK)" ]; then \
		unzip Sparkle.zip; \
	fi

$(APP_BUNDLE): main.swift Info.plist AppIcon.icns setup-sparkle
	@echo "Building Lace menu bar app with Sparkle..."
	@mkdir -p $(MACOS_DIR)
	@mkdir -p $(RESOURCES_DIR)
	@mkdir -p $(FRAMEWORKS_DIR)
	
	# Copy Sparkle framework
	@echo "Embedding Sparkle framework..."
	cp -R $(SPARKLE_FRAMEWORK) $(FRAMEWORKS_DIR)/
	
	# Compile Swift app with Sparkle
	@echo "Compiling Swift app with Sparkle support..."
	swiftc -o $(MACOS_DIR)/$(APP_NAME) main.swift \
		-target arm64-apple-macos10.15 \
		-framework Cocoa \
		-framework ServiceManagement \
		-F $(FRAMEWORKS_DIR) \
		-framework Sparkle \
		-Xlinker -rpath -Xlinker @executable_path/../Frameworks
	
	# Copy Info.plist
	cp Info.plist $(CONTENTS_DIR)/
	
	# Copy app icon
	cp AppIcon.icns $(RESOURCES_DIR)/
	
	@echo "App bundle created at $(APP_BUNDLE)"
	@echo "Don't forget to code sign the Sparkle framework for distribution!"

test-swift: SwiftValidationTests.swift main.swift
	@echo "Running Swift validation tests..."
	@mkdir -p $(TEST_DIR)
	
	# Compile and run Swift validation tests (no XCTest dependency)
	swiftc -o $(TEST_DIR)/SwiftValidationTests \
		SwiftValidationTests.swift \
		-framework Cocoa \
		-framework ServiceManagement \
		-target arm64-apple-macos10.15
	
	# Run the validation tests
	$(TEST_DIR)/SwiftValidationTests

test: test-swift
	@echo "Running all macOS app tests..."

clean:
	rm -rf $(BUILD_DIR)

install-server: $(APP_BUNDLE)
	@echo "Note: Server binary should be copied to $(MACOS_DIR)/lace-server by build script"