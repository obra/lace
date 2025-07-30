# Tool Renderer System Implementation Plan

**Date**: 2025-07-30  
**Objective**: Create a modular tool renderer system that allows per-tool customization of display logic while maintaining DRY principles and type safety.

## Overview

Currently, all tool display logic is hardcoded in `ToolCallDisplay.tsx`. This plan creates a system where each tool type can customize its display behavior (summary, result rendering, error detection) while falling back to sensible defaults.

## Architecture Summary

- **ToolCallDisplay**: Main container with rich UI (header, icons, status). Dispatches to tool renderers for customizable parts.
- **Tool renderers**: Simple objects with optional methods for customizing display behavior.
- **Fallback system**: ToolCallDisplay provides default implementations for all methods.
- **No interfaces/classes**: Use plain objects and optional method calls.

## Key Principles

- **YAGNI**: Only implement what's needed now
- **DRY**: Extract current hardcoded logic into reusable defaults
- **TDD**: Write failing tests first, implement minimal code to pass
- **Type Safety**: Never use `any` types - use proper TypeScript typing
- **Real Code Paths**: Never mock functionality under test - use real business logic
- **Frequent Commits**: Commit after each small working increment

## Prerequisites

### Files You'll Need to Understand

1. **Current Implementation**: `packages/web/components/ui/ToolCallDisplay.tsx`
   - Study the existing logic for tool summaries, error detection, result formatting
   - Note the `createToolSummary`, `isErrorResult`, `formatToolResult` functions
   - Understand the `ExpandableResult` component

2. **Tool Types**: `src/tools/types.ts`
   - Understand the `ToolResult` interface: `{ content: ContentBlock[]; isError: boolean; id?: string }`
   - Understand `ContentBlock`: `{ type: string; text?: string; data?: string; uri?: string }`

3. **Test Patterns**: Look at existing tests in `packages/web/components/ui/`
   - See how components are tested with real data
   - Note the factory pattern for creating test data

### TypeScript Guidelines

- **Never use `any`** - use `unknown` and type guards instead
- **Use proper interfaces** - define types for all data structures
- **Optional properties** - use `?:` for optional methods/properties
- **Type assertions** - use `as Type` only when you're certain of the type

### Testing Guidelines

- **No mocking business logic** - always use real ToolResult objects, real arguments
- **Factory functions** - create helper functions to generate test data
- **Test behavior, not implementation** - test what the user sees, not internal method calls
- **Comprehensive coverage** - test all code paths, error cases, edge cases

## Implementation Tasks

### Task 1: Set Up File Structure and Types

**Objective**: Create the basic file structure and TypeScript interfaces.

**Files to create**:
- `packages/web/components/timeline/tool/types.ts`
- `packages/web/components/timeline/tool/index.ts`

**Step 1.1**: Create type definitions

Create `packages/web/components/timeline/tool/types.ts`:

```typescript
// ABOUTME: Type definitions for tool renderer system
// ABOUTME: Defines interfaces and helper types for customizable tool display logic

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; uri?: string }>;
  isError?: boolean;
  id?: string;
}

export interface ToolRenderer {
  getSummary?: (args: unknown) => string;
  isError?: (result: ToolResult) => boolean;
  renderResult?: (result: ToolResult) => React.ReactNode;
  getIcon?: () => import('@fortawesome/fontawesome-svg-core').IconDefinition;
}

// Helper type to ensure tool renderer objects match the interface
export type ToolRendererDefinition = Partial<ToolRenderer>;
```

**Step 1.2**: Create registry stub

Create `packages/web/components/timeline/tool/index.ts`:

```typescript
// ABOUTME: Tool renderer registry and lookup functions
// ABOUTME: Maps tool names to their custom display logic with fallback support

import type { ToolRenderer } from './types';

// Registry of tool renderers - add new tools here
const toolRenderers: Record<string, ToolRenderer> = {
  // Will be populated in later tasks
};

/**
 * Get the renderer for a specific tool type
 * Returns empty object if no custom renderer exists (uses all fallbacks)
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  return toolRenderers[toolName.toLowerCase()] || {};
}

export type { ToolRenderer, ToolResult } from './types';
```

**Testing**:
- Create `packages/web/components/timeline/tool/index.test.ts`
- Test that `getToolRenderer('unknown')` returns empty object
- Test that registry lookup is case-insensitive

**Commit**: "feat: add tool renderer type definitions and registry"

---

### Task 2: Extract Default Implementations from ToolCallDisplay

**Objective**: Extract the existing hardcoded logic into reusable default functions that can serve as fallbacks.

**File to modify**: `packages/web/components/ui/ToolCallDisplay.tsx`

**Step 2.1**: Extract tool summary logic

Find the existing `createToolSummary` function and extract it to a standalone function:

```typescript
// Add near the top of the file, after imports
function createDefaultToolSummary(toolName: string, args: unknown): string {
  // Move the existing createToolSummary logic here
  // Keep it exactly the same - this is just a refactor
}
```

**Step 2.2**: Extract error detection logic

Extract the existing `isErrorResult` function:

```typescript
function isDefaultError(result: { content: Array<{ text?: string }>; isError?: boolean; id?: string }): boolean {
  // Move the existing isErrorResult logic here
  return Boolean(result?.isError);
}
```

**Step 2.3**: Extract result formatting logic

Extract the existing result formatting:

```typescript
function createDefaultResultRenderer(result: { content: Array<{ text?: string }>; isError?: boolean; id?: string }): React.ReactNode {
  // Move the existing ExpandableResult component logic here
  // Return the JSX that renders the result content
}
```

**Step 2.4**: Update the main component to use extracted functions

Replace the calls to the old functions with calls to the new default functions:

```typescript
// In the main ToolCallDisplay component:
const toolSummary = createDefaultToolSummary(tool, args);
const isError = isDefaultError(result!);
const resultContent = createDefaultResultRenderer(result!);
```

**Testing**:
- Run existing tests to ensure no regressions
- All existing functionality should work exactly the same

**Commit**: "refactor: extract default tool display logic into standalone functions"

---

### Task 3: Integrate Tool Renderer System

**Objective**: Modify ToolCallDisplay to use the tool renderer system with fallbacks to the default implementations.

**File to modify**: `packages/web/components/ui/ToolCallDisplay.tsx`

**Step 3.1**: Add imports

Add the import at the top:

```typescript
import { getToolRenderer } from '@/components/timeline/tool';
```

**Step 3.2**: Update the main component logic

Replace the hardcoded function calls with renderer-aware logic:

```typescript
export function ToolCallDisplay({
  tool,
  content,
  result,
  timestamp,
  metadata,
  className = '',
}: ToolCallDisplayProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  
  // Get the custom renderer for this tool type
  const renderer = getToolRenderer(tool);
  
  const toolIcon = renderer.getIcon?.() ?? getToolIcon(tool);
  const hasResult = result?.content?.some(block => block.text?.trim());
  const isError = hasResult && (renderer.isError?.(result!) ?? isDefaultError(result!));
  const args = metadata?.arguments;
  const hasArgs = args && typeof args === 'object' && args !== null && Object.keys(args).length > 0;
  const toolSummary = renderer.getSummary?.(args) ?? createDefaultToolSummary(tool, args);
  const resultContent = hasResult ? (renderer.renderResult?.(result!) ?? createDefaultResultRenderer(result!)) : null;

  // Rest of the component stays the same...
}
```

**Step 3.3**: Update result rendering section

In the JSX, replace the old result rendering with the new resultContent:

```typescript
{/* Tool Result */}
{resultContent && resultContent}

{/* No result message - only show if no result content */}
{!hasResult && (
  <div className="p-3 text-center text-base-content/50 text-sm">
    <FontAwesomeIcon icon={faTerminal} className="mr-2" />
    Tool executed, no output returned
  </div>
)}
```

**Testing**:
- Run existing tests to ensure no regressions
- Verify that tools without custom renderers still work exactly as before
- Test that `getToolRenderer('bash')` returns empty object and uses fallbacks

**Commit**: "feat: integrate tool renderer system with fallback support"

---

### Task 4: Create Bash Tool Renderer

**Objective**: Create a specialized renderer for bash tool with custom summary and terminal-style result display.

**File to create**: `packages/web/components/timeline/tool/bash.tsx`

**Step 4.1**: Write failing test first

Create `packages/web/components/timeline/tool/bash.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import bashRenderer from './bash';

// Factory function for creating test data
function createBashResult(stdout: string, stderr: string = '', exitCode: number = 0) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ stdout, stderr, exitCode })
    }],
    isError: false,
    id: 'test-id'
  };
}

describe('Bash Tool Renderer', () => {
  describe('getSummary', () => {
    it('should format command with $ prefix', () => {
      const args = { command: 'ls -la' };
      const summary = bashRenderer.getSummary!(args);
      expect(summary).toBe('$ ls -la');
    });

    it('should handle missing command', () => {
      const args = {};
      const summary = bashRenderer.getSummary!(args);
      expect(summary).toBe('$ (no command)');
    });
  });

  describe('isError', () => {
    it('should return true for non-zero exit code', () => {
      const result = createBashResult('output', '', 1);
      expect(bashRenderer.isError!(result)).toBe(true);
    });

    it('should return true when stderr is present', () => {
      const result = createBashResult('output', 'error message', 0);
      expect(bashRenderer.isError!(result)).toBe(true);
    });

    it('should return false for successful execution', () => {
      const result = createBashResult('output', '', 0);
      expect(bashRenderer.isError!(result)).toBe(false);
    });
  });

  describe('renderResult', () => {
    it('should render stdout in terminal style', () => {
      const result = createBashResult('Hello World', '', 0);
      const rendered = bashRenderer.renderResult!(result);
      
      render(<div>{rendered}</div>);
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('should render stderr with error styling', () => {
      const result = createBashResult('', 'Command failed', 1);
      const rendered = bashRenderer.renderResult!(result);
      
      render(<div>{rendered}</div>);
      expect(screen.getByText('Command failed')).toBeInTheDocument();
      // Should have error styling
    });

    it('should handle no output gracefully', () => {
      const result = createBashResult('', '', 0);
      const rendered = bashRenderer.renderResult!(result);
      
      render(<div>{rendered}</div>);
      expect(screen.getByText(/no output|completed/i)).toBeInTheDocument();
    });
  });
});
```

**Step 4.2**: Implement the bash renderer

Create `packages/web/components/timeline/tool/bash.tsx`:

```typescript
// ABOUTME: Bash tool renderer with terminal-style display and command formatting
// ABOUTME: Provides custom summary, error detection, and stdout/stderr rendering

import { useState } from 'react';
import type { ToolRenderer, ToolResult } from './types';

// Terminal output component for expandable stdout/stderr
function TerminalOutput({ 
  content, 
  isError = false,
  label 
}: { 
  content: string; 
  isError?: boolean;
  label?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!content.trim()) return null;
  
  const lines = content.split('\n');
  const shouldShowExpand = lines.length > 8;
  const displayContent = isExpanded ? content : lines.slice(0, 8).join('\n');
  
  return (
    <div className="mb-3 last:mb-0">
      {label && (
        <div className={`text-xs font-medium mb-1 ${
          isError ? 'text-red-600' : 'text-gray-600'
        }`}>
          {label}
        </div>
      )}
      <div className={`rounded border font-mono text-sm ${
        isError 
          ? 'bg-red-50 border-red-200 text-red-800' 
          : 'bg-gray-50 border-gray-200 text-gray-800'
      }`}>
        <pre className="p-3 whitespace-pre-wrap break-words overflow-x-auto">
          {displayContent}
          {shouldShowExpand && !isExpanded && (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-gray-500 hover:text-gray-700 cursor-pointer mt-2 block text-xs"
            >
              ... ({lines.length - 8} more lines)
            </button>
          )}
          {shouldShowExpand && isExpanded && (
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-500 hover:text-gray-700 cursor-pointer mt-2 block text-xs"
            >
              Show less
            </button>
          )}
        </pre>
      </div>
    </div>
  );
}

const bashRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (!args || typeof args !== 'object') return '$ (no command)';
    const argsObj = args as Record<string, unknown>;
    const command = argsObj.command;
    if (typeof command === 'string') {
      return `$ ${command}`;
    }
    return '$ (no command)';
  },

  isError: (result: ToolResult): boolean => {
    // First check the ToolResult's isError flag
    if (result.isError) return true;

    try {
      const textContent = result.content
        .map((block) => block.text ?? '')
        .join('');

      const bashResult = JSON.parse(textContent) as { 
        stdout?: string; 
        stderr?: string; 
        exitCode?: number; 
      };

      // Error if non-zero exit code or stderr present
      return bashResult.exitCode !== 0 || Boolean(bashResult.stderr?.trim());
    } catch {
      // If we can't parse the result, use the ToolResult's isError flag
      return Boolean(result.isError);
    }
  },

  renderResult: (result: ToolResult) => {
    const textContent = result.content
      .map((block) => block.text ?? '')
      .join('');

    try {
      const bashResult = JSON.parse(textContent) as { 
        stdout?: string; 
        stderr?: string; 
        exitCode?: number; 
      };

      const hasStdout = bashResult.stdout?.trim();
      const hasStderr = bashResult.stderr?.trim();

      if (!hasStdout && !hasStderr) {
        return (
          <div className="p-3 text-center text-gray-500 text-sm bg-gray-50 rounded border">
            ✅ Command completed with no output
          </div>
        );
      }

      return (
        <div className="p-3">
          {hasStdout && (
            <TerminalOutput content={bashResult.stdout!} />
          )}
          {hasStderr && (
            <TerminalOutput 
              content={bashResult.stderr!} 
              isError={true}
              label="stderr"
            />
          )}
          {bashResult.exitCode !== undefined && bashResult.exitCode !== 0 && (
            <div className="text-xs text-red-600 mt-2">
              ⚠️ Exit code: {bashResult.exitCode}
            </div>
          )}
        </div>
      );
    } catch {
      // Fallback for malformed JSON - render as plain text
      return (
        <div className="p-3">
          <div className="bg-gray-50 border border-gray-200 rounded">
            <pre className="p-3 font-mono text-sm whitespace-pre-wrap break-words">
              {textContent || '(no output)'}
            </pre>
          </div>
        </div>
      );
    }
  }
};

export default bashRenderer;
```

**Step 4.3**: Register the bash renderer

Update `packages/web/components/timeline/tool/index.ts`:

```typescript
import type { ToolRenderer } from './types';
import bashRenderer from './bash';

// Registry of tool renderers - add new tools here
const toolRenderers: Record<string, ToolRenderer> = {
  bash: bashRenderer,
};

// ... rest stays the same
```

**Testing**:
- Run the tests: `npm test bash.test.tsx`
- All tests should pass
- Test integration by using a bash tool in the UI

**Commit**: "feat: add bash tool renderer with terminal-style display"

---

### Task 5: Integration Testing and Bug Fixes

**Objective**: Test the complete system end-to-end and fix any issues found.

**Step 5.1**: Create integration tests

Create `packages/web/components/ui/ToolCallDisplay.integration.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { ToolCallDisplay } from './ToolCallDisplay';

// Factory functions for creating test data
function createToolResult(content: string, isError = false) {
  return {
    content: [{ type: 'text', text: content }],
    isError,
    id: 'test-id'
  };
}

function createBashToolResult(stdout: string, stderr = '', exitCode = 0) {
  return createToolResult(JSON.stringify({ stdout, stderr, exitCode }));
}

describe('ToolCallDisplay Integration', () => {
  it('should use default renderer for unknown tools', () => {
    const result = createToolResult('Some output');
    
    render(
      <ToolCallDisplay
        tool="unknown_tool"
        content="Test"
        result={result}
        timestamp={new Date()}
      />
    );

    expect(screen.getByText('Some output')).toBeInTheDocument();
    expect(screen.getByText('Executed unknown_tool')).toBeInTheDocument();
  });

  it('should use bash renderer for bash tools', () => {
    const result = createBashToolResult('Hello World');
    
    render(
      <ToolCallDisplay
        tool="bash"
        content="Test"
        result={result}
        timestamp={new Date()}
        metadata={{ arguments: { command: 'echo "Hello World"' } }}
      />
    );

    expect(screen.getByText('Hello World')).toBeInTheDocument();
    expect(screen.getByText('$ echo "Hello World"')).toBeInTheDocument();
  });

  it('should handle bash errors correctly', () => {
    const result = createBashToolResult('', 'Command failed', 1);
    
    render(
      <ToolCallDisplay
        tool="bash"
        content="Test"
        result={result}
        timestamp={new Date()}
        metadata={{ arguments: { command: 'bad-command' } }}
      />
    );

    expect(screen.getByText('Command failed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument(); // Error status
  });

  it('should fall back to defaults when renderer methods are missing', () => {
    // Test that partial renderer implementations work
    const result = createToolResult('Some output');
    
    render(
      <ToolCallDisplay
        tool="bash"
        content="Test"
        result={result}
        timestamp={new Date()}
      />
    );

    // Should still render, using defaults where bash renderer doesn't implement
    expect(screen.getByText('Some output')).toBeInTheDocument();
  });
});
```

**Step 5.2**: Manual testing checklist

Test these scenarios in the browser:

1. **Bash tool with stdout only**: Should show terminal-style output
2. **Bash tool with stderr**: Should show red error styling  
3. **Bash tool with no output**: Should show "Command completed with no output"
4. **Unknown tool**: Should use default rendering
5. **Error states**: Should show correct error indicators
6. **Expandable content**: Long output should be expandable
7. **Technical details**: Show/hide should still work

**Step 5.3**: Fix any bugs found

Common issues to watch for:
- TypeScript errors (no `any` types allowed)
- Missing null/undefined checks
- CSS styling issues
- React key warnings
- Performance issues with large outputs

**Testing**:
- All integration tests pass
- Manual testing scenarios work
- No console errors or warnings

**Commit**: "test: add integration tests and fix any bugs found"

---

### Task 6: Clean Up Old Code

**Objective**: Remove the old hardcoded logic that has been replaced by the renderer system.

**Files to modify**: `packages/web/components/ui/ToolCallDisplay.tsx`

**Step 6.1**: Remove unused functions

Remove these functions that are now replaced:
- Old `createToolSummary` (replaced by `createDefaultToolSummary`)
- Old `isErrorResult` (replaced by `isDefaultError`) 
- Old `formatToolResult` (replaced by `createDefaultResultRenderer`)
- Old `ExpandableResult` component (moved to default renderer)

**Step 6.2**: Remove unused imports

Remove any imports that are no longer needed after cleanup.

**Step 6.3**: Update variable names for clarity

Rename the extracted functions to be clearer:
- `createDefaultToolSummary` → `getDefaultSummary`
- `isDefaultError` → `getDefaultErrorStatus`
- `createDefaultResultRenderer` → `getDefaultResultContent`

**Testing**:
- All existing tests still pass
- No unused code warnings
- Bundle size should be similar or smaller

**Commit**: "cleanup: remove old hardcoded tool display logic"

---

### Task 7: Documentation and Examples

**Objective**: Document the new system for future developers.

**Step 7.1**: Create developer documentation

Create `packages/web/components/timeline/tool/README.md`:

```markdown
# Tool Renderer System

This system allows customizing how different tool types are displayed in the UI.

## How It Works

1. `ToolCallDisplay` is the main container with all the rich UI (header, status, etc.)
2. For customizable parts, it looks up a tool renderer using `getToolRenderer(toolName)`
3. Tool renderers are simple objects with optional methods
4. If a renderer doesn't implement a method, ToolCallDisplay uses sensible defaults

## Adding a New Tool Renderer

1. Create a new file: `components/timeline/tool/my-tool.tsx`
2. Export a default object with the methods you want to customize:

```typescript
import type { ToolRenderer } from './types';

const myToolRenderer: ToolRenderer = {
  getSummary: (args: unknown) => {
    // Return custom summary string
  },
  
  renderResult: (result: ToolResult) => {
    // Return custom JSX for result display
  },
  
  isError: (result: ToolResult) => {
    // Return boolean for error detection
  }
};

export default myToolRenderer;
```

3. Register it in `index.ts`:

```typescript
import myToolRenderer from './my-tool';

const toolRenderers: Record<string, ToolRenderer> = {
  bash: bashRenderer,
  my_tool: myToolRenderer, // Add here
};
```

## Available Methods

- `getSummary(args)`: Custom tool summary (e.g., "$ command" for bash)
- `isError(result)`: Custom error detection logic
- `renderResult(result)`: Custom result content rendering
- `getIcon()`: Custom FontAwesome icon

All methods are optional - implement only what you need to customize.
```

**Step 7.2**: Add JSDoc comments

Add comprehensive JSDoc comments to all public functions and interfaces.

**Step 7.3**: Update main README if needed

Add a section about tool renderers to the main project README.

**Commit**: "docs: add comprehensive tool renderer system documentation"

---

### Task 8: Performance Testing and Optimization

**Objective**: Ensure the new system performs well with large outputs and many tools.

**Step 8.1**: Create performance tests

Test with:
- Very long bash output (1000+ lines)
- Many tool calls on one page (20+ tools)
- Rapid tool execution

**Step 8.2**: Profile and optimize

Use React DevTools profiler to identify any performance issues.

Common optimizations:
- Memoize expensive computations
- Lazy load renderer components
- Optimize re-renders

**Step 8.3**: Add performance test suite

Create automated performance tests that fail if rendering takes too long.

**Commit**: "perf: optimize tool renderer system performance"

---

## Testing Strategy

### Test Data Factories

Create helper functions for generating test data:

```typescript
// Test utilities
export function createToolResult(content: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: content }],
    isError,
    id: 'test-id'
  };
}

export function createBashResult(stdout: string, stderr = '', exitCode = 0): ToolResult {
  return createToolResult(JSON.stringify({ stdout, stderr, exitCode }));
}
```

### Test Coverage Requirements

- **Unit tests**: Each tool renderer function
- **Integration tests**: ToolCallDisplay with different renderers
- **Edge cases**: Malformed data, missing properties, empty content
- **Error cases**: Network failures, parsing errors, missing tools
- **Performance tests**: Large outputs, many renderers

### What NOT to Mock

- Never mock `ToolResult` objects - use real data
- Never mock renderer methods - test the actual implementation
- Never mock the registry lookup - test the real flow

### What's OK to Mock

- External APIs (if any)
- File system operations (if any)
- Timer/animation functions (if needed)

## Definition of Done

- [ ] All tests pass with 100% coverage
- [ ] No TypeScript errors or warnings
- [ ] No `any` types used anywhere
- [ ] All manual testing scenarios work
- [ ] Performance is acceptable (< 100ms render for normal outputs)
- [ ] Documentation is complete and accurate
- [ ] Code is clean and follows project conventions
- [ ] All old code has been removed
- [ ] System is deployed and working in production

## Notes for Implementation

- **Start simple**: Implement minimal functionality first, then enhance
- **Test frequently**: Run tests after every small change
- **Commit often**: Small, focused commits with clear messages
- **Ask questions**: If anything is unclear, ask before proceeding
- **Follow patterns**: Look at existing code for style and patterns
- **Type everything**: Never use `any` - use proper TypeScript types
- **Real tests**: Always test real functionality, not mocks