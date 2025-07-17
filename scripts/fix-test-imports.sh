#!/bin/bash

# ABOUTME: Script to fix broken import statements in test files
# ABOUTME: Cleans up malformed imports from the previous script

set -e

echo "🔧 Fixing broken import statements..."

# Fix the broken import statements by reverting and applying correct fixes
find src -name "*.test.ts" -o -name "*/__tests__/*.ts" | while read file; do
  if grep -q "import.*resetPersistence.*getPersistence.*from.*persistence/database.*;" "$file"; then
    echo "  Fixing imports in $file"
    
    # Remove the malformed import line
    sed -i.bak '/^import { resetPersistence, getPersistence } from.*persistence\/database.*;\$/d' "$file"
    
    # Fix existing database imports to include resetPersistence and getPersistence
    if grep -q "import.*from.*persistence/database" "$file"; then
      # Update existing import to include the new functions
      sed -i.bak 's/import { \([^}]*\) } from.*persistence\/database/import { \1, resetPersistence, getPersistence } from '\''~\/persistence\/database'\''/g' "$file"
    else
      # Add new import at the top
      sed -i.bak '1i\
import { resetPersistence, getPersistence } from '\''~/persistence/database'\'';
' "$file"
    fi
    
    # Clean up backup files
    rm -f "$file.bak"
  fi
done

echo "✅ Import statements fixed!"