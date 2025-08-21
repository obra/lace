# Build Lace menu bar app
.PHONY: build clean

APP_NAME = Lace
BUILD_DIR = build
APP_BUNDLE = $(BUILD_DIR)/$(APP_NAME).app
CONTENTS_DIR = $(APP_BUNDLE)/Contents
MACOS_DIR = $(CONTENTS_DIR)/MacOS
RESOURCES_DIR = $(CONTENTS_DIR)/Resources

build: $(APP_BUNDLE)

$(APP_BUNDLE): main.swift Info.plist AppIcon.icns
	@echo "Building Lace menu bar app..."
	@mkdir -p $(MACOS_DIR)
	@mkdir -p $(RESOURCES_DIR)
	
	# Compile Swift app
	swiftc -o $(MACOS_DIR)/$(APP_NAME) main.swift -target arm64-apple-macos10.15
	
	# Copy Info.plist
	cp Info.plist $(CONTENTS_DIR)/
	
	# Copy app icon
	cp AppIcon.icns $(RESOURCES_DIR)/
	
	@echo "App bundle created at $(APP_BUNDLE)"

clean:
	rm -rf $(BUILD_DIR)

install-server: $(APP_BUNDLE)
	@echo "Note: Server binary should be copied to $(MACOS_DIR)/lace-server by build script"