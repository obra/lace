#!/bin/bash

# List of remaining route files to process
FILES=(
    "app/api/sessions/[sessionId]/agents/route.ts"
    "app/api/sessions/[sessionId]/configuration/route.ts"
    "app/api/sessions/[sessionId]/history/route.ts"
    "app/api/sessions/[sessionId]/route.ts"
    "app/api/sessions/route.ts"
    "app/api/threads/[threadId]/approvals/[toolCallId]/route.ts"
    "app/api/threads/[threadId]/approvals/pending/route.ts"
    "app/api/threads/[threadId]/message/route.ts"
    "app/api/projects/[projectId]/sessions/[sessionId]/route.ts"
    "app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/notes/route.ts"
    "app/api/projects/[projectId]/sessions/[sessionId]/tasks/[taskId]/route.ts"
    "app/api/projects/[projectId]/sessions/[sessionId]/tasks/route.ts"
    "app/api/projects/[projectId]/sessions/route.ts"
    "app/api/projects/[projectId]/templates/[templateId]/route.ts"
    "app/api/projects/[projectId]/templates/route.ts"
    "app/api/projects/[projectId]/token-budget/route.ts"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "Processing $file..."
        
        # Add import if not already present
        if ! grep -q "createErrorResponse" "$file"; then
            sed -i '' '/import.*createSuperjsonResponse/a\
import { createErrorResponse } from '\''@/lib/server/api-utils'\'';' "$file"
        fi
        
        # Replace common error patterns
        sed -i '' 's/createSuperjsonResponse({ error: '\''Project not found'\'' }, { status: 404 })/createErrorResponse('\''Project not found'\'', 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        sed -i '' 's/createSuperjsonResponse({ error: '\''Session not found'\'' }, { status: 404 })/createErrorResponse('\''Session not found'\'', 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        sed -i '' 's/createSuperjsonResponse({ error: '\''Agent not found'\'' }, { status: 404 })/createErrorResponse('\''Agent not found'\'', 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        sed -i '' 's/createSuperjsonResponse({ error: '\''Thread not found'\'' }, { status: 404 })/createErrorResponse('\''Thread not found'\'', 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        sed -i '' 's/createSuperjsonResponse({ error: '\''Task not found'\'' }, { status: 404 })/createErrorResponse('\''Task not found'\'', 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        sed -i '' 's/createSuperjsonResponse({ error: '\''Template not found'\'' }, { status: 404 })/createErrorResponse('\''Template not found'\'', 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        
        # More generic 404 patterns
        sed -i '' 's/createSuperjsonResponse({ error: \([^}]*\) }, { status: 404 })/createErrorResponse(\1, 404, { code: '\''RESOURCE_NOT_FOUND'\'' })/g' "$file"
        
        # 400 validation errors
        sed -i '' 's/createSuperjsonResponse({ error: '\''Invalid.*'\'' }, { status: 400 })/createErrorResponse(&, 400, { code: '\''VALIDATION_FAILED'\'' })/g' "$file"
        
        echo "Processed $file"
    else
        echo "File not found: $file"
    fi
done

echo "Migration script completed"