#!/bin/bash

# ABOUTME: Script to fix persistence patterns in test files
# ABOUTME: Updates test files to use resetPersistence() and getPersistence() patterns

set -e

echo "🧪 Fixing test persistence patterns..."

# 1. Update test files to use resetPersistence and getPersistence
echo "📝 Updating test files..."

find src -name "*.test.ts" -o -name "*/__tests__/*.ts" | while read file; do
  if grep -q "new DatabasePersistence\|new ThreadManager(" "$file"; then
    echo "  Updating test file: $file"
    
    # Add resetPersistence import if needed
    if ! grep -q "resetPersistence" "$file"; then
      if grep -q "import.*from.*persistence/database" "$file"; then
        sed -i.bak 's/import { \([^}]*\) } from.*persistence\/database/import { \1, resetPersistence, getPersistence } from '\''~\/persistence\/database'\''/g' "$file"
      else
        # Add import at the top
        sed -i.bak '1i\
import { resetPersistence, getPersistence } from '\''~/persistence/database'\'';
' "$file"
      fi
    fi
    
    # Replace new DatabasePersistence(path) with getPersistence()
    sed -i.bak 's/new DatabasePersistence([^)]*)/getPersistence()/g' "$file"
    
    # Replace new ThreadManager(path) with new ThreadManager()
    sed -i.bak 's/new ThreadManager([^)]*)/new ThreadManager()/g' "$file"
    
    # Add resetPersistence() calls in beforeEach/afterEach if not present
    if ! grep -q "resetPersistence" "$file"; then
      # This is a more complex pattern - let's add a comment for manual review
      sed -i.bak '/beforeEach/a\
    // TODO: Add resetPersistence() call here for test isolation
' "$file"
    fi
    
    # Clean up backup files
    rm -f "$file.bak"
  fi
done

echo "✅ Test persistence patterns updated!"
echo "⚠️  Manual review needed for test isolation (resetPersistence calls)"