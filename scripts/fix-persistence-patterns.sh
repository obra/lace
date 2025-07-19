#!/bin/bash

# ABOUTME: Script to fix persistence patterns across the codebase
# ABOUTME: Replaces DatabasePersistence constructor calls with getPersistence() and updates ThreadManager constructors

set -e

echo "🔧 Fixing persistence patterns..."

# 1. Replace new DatabasePersistence(path) with getPersistence()
echo "📝 Updating DatabasePersistence imports and usage..."

# Find files that import DatabasePersistence and update them
find src -name "*.ts" -not -path "*/node_modules/*" -not -path "*/__tests__/*" -not -name "*.test.ts" | while read file; do
  if grep -q "import.*DatabasePersistence.*from" "$file"; then
    echo "  Updating imports in $file"
    
    # Update import statement
    sed -i.bak 's/import { DatabasePersistence/import { getPersistence/g' "$file"
    sed -i.bak 's/DatabasePersistence,/getPersistence,/g' "$file"
    sed -i.bak 's/, DatabasePersistence/, getPersistence/g' "$file"
    
    # Update constructor calls
    sed -i.bak 's/new DatabasePersistence([^)]*)/getPersistence()/g' "$file"
    
    # Clean up backup files
    rm -f "$file.bak"
  fi
done

# 2. Fix ThreadManager constructor calls
echo "📝 Updating ThreadManager constructor calls..."

find src -name "*.ts" -not -path "*/node_modules/*" -not -path "*/__tests__/*" -not -name "*.test.ts" | while read file; do
  if grep -q "new ThreadManager(" "$file"; then
    echo "  Updating ThreadManager calls in $file"
    
    # Replace new ThreadManager(anything) with new ThreadManager()
    sed -i.bak 's/new ThreadManager([^)]*)/new ThreadManager()/g' "$file"
    
    # Clean up backup files
    rm -f "$file.bak"
  fi
done

# 3. Update Project class to use getPersistence
echo "📝 Updating Project class..."
if [ -f "src/projects/project.ts" ]; then
  sed -i.bak 's/persistence\./getPersistence()./g' "src/projects/project.ts"
  rm -f "src/projects/project.ts.bak"
fi

echo "✅ Persistence patterns updated!"
echo "🧪 Run tests to verify the changes work correctly."