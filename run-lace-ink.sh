#!/bin/bash

# ABOUTME: Simple script to run lace-ink UI in proper terminal mode
# ABOUTME: Use this to test the UI in a real terminal environment

echo "🧵 Starting Lace-Ink UI..."
echo "Press Ctrl+C to exit"
echo ""

# Run with tsx for TypeScript support
npx tsx src/ui/lace-cli.js "$@"