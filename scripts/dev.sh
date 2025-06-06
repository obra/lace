#!/bin/bash

# ABOUTME: Silent development script that builds web assets and starts CLI
# ABOUTME: Completely suppresses npm and build output for clean CLI experience

# Build web assets silently
VITE_SILENT=true node scripts/build-web.js > /dev/null 2>&1

# Start the CLI
node --watch src/cli.js