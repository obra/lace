#!/bin/bash

# Script to add persistence helper to test files that are missing it

# List of files that need persistence helper
FILES=(
  "src/agents/__tests__/agent-thread-events.test.ts"
  "src/agents/__tests__/agent-token-budget.test.ts"
  "src/agents/__tests__/agent-threadmanager-encapsulation.test.ts"
  "src/agents/__tests__/agent-token-tracking.test.ts"
  "src/threads/__tests__/compaction-integration.test.ts"
  "src/agents/__tests__/turn-tracking-integration.test.ts"
  "src/tools/__tests__/delegate.test.ts"
  "src/agents/agent-thread-events.test.ts"
  "src/__tests__/agent-thread-integration.test.ts"
  "src/tools/implementations/task-manager/__tests__/tools.test.ts"
  "src/tools/implementations/task-manager/__tests__/formatter.test.ts"
  "src/interfaces/__tests__/non-interactive-race-condition.test.ts"
  "src/interfaces/__tests__/non-interactive-interface.test.ts"
  "src/commands/__tests__/executor.test.ts"
  "src/agents/__tests__/conversation-building-regression.test.ts"
  "src/agents/__tests__/agent-sendmessage-queue.test.ts"
  "src/agents/__tests__/agent-retry-events.test.ts"
  "src/agents/__tests__/agent-queue-processing.test.ts"
  "src/agents/__tests__/agent-queue-methods.test.ts"
  "src/agents/__tests__/agent-queue-e2e.test.ts"
  "src/agents/__tests__/agent-getqueue-contents.test.ts"
  "src/__tests__/cli-flow.test.ts"
  "packages/web/hooks/__tests__/useSessionAPI.test.ts"
  "packages/web/hooks/__tests__/useTaskManager.test.tsx"
  "packages/web/__tests__/integration/full-flow.test.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    
    # Check if persistence helper is already imported
    if ! grep -q "setupTestPersistence" "$file"; then
      echo "  Adding persistence helper import..."
      
      # Add import after other test imports
      sed -i '' '/import.*vitest.*{/,/}/ {
        /afterEach.*vi/ s/afterEach/afterEach, afterEach as originalAfterEach/
        /beforeEach.*vi/ a\
import { setupTestPersistence, teardownTestPersistence } from '\''~/__tests__/setup/persistence-helper'\'';
      }' "$file"
      
      # If that didn't work, try a simpler approach
      if ! grep -q "setupTestPersistence" "$file"; then
        # Find the line with vitest imports and add after it
        sed -i '' '/import.*from.*vitest/a\
import { setupTestPersistence, teardownTestPersistence } from '\''~/__tests__/setup/persistence-helper'\'';
' "$file"
      fi
    fi
    
    # Add setupTestPersistence to beforeEach if not present
    if grep -q "beforeEach" "$file" && ! grep -q "setupTestPersistence" "$file"; then
      echo "  Adding setupTestPersistence to beforeEach..."
      sed -i '' '/beforeEach.*{/,/^  }/ {
        /beforeEach.*{/ a\
    setupTestPersistence();
      }' "$file"
    fi
    
    # Add teardownTestPersistence to afterEach if not present
    if grep -q "afterEach" "$file" && ! grep -q "teardownTestPersistence" "$file"; then
      echo "  Adding teardownTestPersistence to afterEach..."
      sed -i '' '/afterEach.*{/,/^  }/ {
        /afterEach.*{/ a\
    teardownTestPersistence();
      }' "$file"
    # If no afterEach exists, create one after beforeEach
    elif grep -q "beforeEach" "$file" && ! grep -q "afterEach" "$file"; then
      echo "  Creating afterEach with teardownTestPersistence..."
      sed -i '' '/beforeEach.*{/,/^  }/ {
        /^  }/ a\
\
  afterEach(() => {\
    teardownTestPersistence();\
  });
      }' "$file"
    fi
    
    echo "  Done with $file"
  else
    echo "File not found: $file"
  fi
done

echo "All files processed!"