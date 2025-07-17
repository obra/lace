#!/bin/bash

# ABOUTME: Script to remove ProjectData interface from ThreadManager and move to database.ts
# ABOUTME: Cleans up architecture by consolidating data interfaces

set -e

echo "🧹 Cleaning up ThreadManager architecture..."

# 1. Remove ProjectData interface from ThreadManager
echo "📝 Removing ProjectData interface from ThreadManager..."

if [ -f "src/threads/thread-manager.ts" ]; then
  # Remove the ProjectData interface definition (lines 12-21)
  sed -i.bak '/^export interface ProjectData {/,/^}/d' "src/threads/thread-manager.ts"
  
  # Remove ProjectData from imports
  sed -i.bak 's/, ProjectData//g' "src/threads/thread-manager.ts"
  sed -i.bak 's/ProjectData, //g' "src/threads/thread-manager.ts"
  
  # Clean up backup file
  rm -f "src/threads/thread-manager.ts.bak"
  
  echo "  ✅ ProjectData interface removed from ThreadManager"
else
  echo "  ⚠️  ThreadManager file not found"
fi

# 2. Update imports in other files that import ProjectData from ThreadManager
echo "📝 Updating ProjectData imports..."

find src -name "*.ts" -not -path "*/node_modules/*" | while read file; do
  if grep -q "import.*ProjectData.*from.*thread-manager" "$file"; then
    echo "  Updating ProjectData import in $file"
    
    # Replace import from thread-manager with import from database
    sed -i.bak 's/import { \([^}]*\)ProjectData\([^}]*\) } from.*thread-manager/import { \1\2 } from '\''~\/threads\/thread-manager'\''/g' "$file"
    sed -i.bak 's/import { \([^}]*\), ProjectData\([^}]*\) } from.*thread-manager/import { \1\2 } from '\''~\/threads\/thread-manager'\''/g' "$file"
    sed -i.bak 's/import { ProjectData\([^}]*\) } from.*thread-manager/import { \1 } from '\''~\/threads\/thread-manager'\''/g' "$file"
    
    # Add ProjectData import from database if needed
    if ! grep -q "import.*ProjectData.*from.*database" "$file"; then
      sed -i.bak '/import.*from.*database/s/}/}, ProjectData/' "$file"
    fi
    
    # Clean up backup files
    rm -f "$file.bak"
  fi
done

echo "✅ ThreadManager cleanup complete!"
echo "🧪 Run tests to verify the changes work correctly."