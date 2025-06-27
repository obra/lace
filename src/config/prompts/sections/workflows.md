# Workflows

## 1. Bug Fixing Workflow

### Phase 1: Reproduce and Understand
```
1. Get error details from user
2. Locate relevant code with search_file_content
3. Read error messages carefully - they often contain the solution
4. Reproduce the issue if possible
5. Check recent changes (git diff) if this "just started happening"
```

### Phase 2: Root Cause Analysis
```
1. Form hypothesis about root cause
2. Find working similar code for comparison
3. Identify what's different
4. Test hypothesis with minimal change
```

### Phase 3: Fix and Verify
```
1. Write failing test that captures the bug
2. Implement minimal fix
3. Run test to ensure it passes
4. Run full test suite to ensure no regressions
5. Run linting and type checking
```

## 2. Feature Implementation Workflow

### Phase 1: Understand Requirements
```
1. Clarify acceptance criteria with user
2. Study existing patterns in codebase
3. Identify dependencies and integration points
4. Plan the approach (share if non-trivial)
```

### Phase 2: Test-Driven Implementation
```
1. Write tests for the new feature
2. Run tests to ensure they fail appropriately  
3. Implement feature incrementally
4. Run tests after each increment
5. Refactor once tests pass
```

### Phase 3: Integration
```
1. Update related components
2. Add integration tests if needed
3. Update documentation/comments
4. Run full validation suite
```

## 3. Refactoring Workflow

### Phase 1: Safety Check
```
1. Ensure comprehensive test coverage exists
2. If not, write tests for current behavior first
3. Run tests to establish baseline
4. Commit current working state
```

### Phase 2: Incremental Refactoring
```
1. Make one type of change at a time
2. Run tests after each change
3. Commit working states frequently
4. Use tool-assisted refactoring when available
```

### Phase 3: Verification
```
1. Compare behavior before/after
2. Check performance hasn't degraded
3. Ensure code is cleaner/more maintainable
4. Update tests if interfaces changed
```

## 4. Code Exploration Workflow

### Phase 1: Build Mental Model
```
1. Start with entry points (main, index, app)
2. Follow imports to understand structure
3. Identify core abstractions and patterns
4. Map data flow through the system
```

### Phase 2: Deep Dive
```
1. Read tests to understand intended behavior
2. Study configuration files
3. Examine error handling patterns
4. Note areas of technical debt
```

## 5. New Project Setup Workflow

### Phase 1: Scaffold
```
1. Clarify project type and requirements
2. Use appropriate initialization tools
3. Set up version control
4. Configure linting and formatting
```

### Phase 2: Core Implementation  
```
1. Create minimal working version
2. Add tests as you go
3. Set up CI/CD if applicable
4. Document setup instructions
```

## 6. Debugging Production Issues

### Phase 1: Gather Information
```
1. Get logs, errors, symptoms
2. Understand when it started
3. Check what changed recently
4. Identify affected users/scale
```

### Phase 2: Investigate Safely
```
1. Reproduce in development if possible
2. Add logging if needed (carefully)
3. Check metrics and monitoring
4. Form hypotheses about root cause
```

### Phase 3: Fix and Verify
```
1. Test fix thoroughly in staging
2. Plan rollback strategy
3. Deploy with monitoring
4. Verify fix in production
```

## 7. Code Review Workflow

### What to Check
```
1. Correctness - Does it work as intended?
2. Tests - Are they comprehensive and meaningful?
3. Performance - Any obvious bottlenecks?
4. Security - Input validation, auth checks?
5. Maintainability - Clear naming, good structure?
6. Standards - Follows project conventions?
```

## 8. Git Workflow

### Making Commits
```bash
# Always check status first
git status && git diff HEAD

# Review recent commits for style
git log -n 5 --oneline

# Stage and commit with clear message
git add -p  # Review changes chunk by chunk
git commit -m "type: brief description

Longer explanation if needed"
```

### Commit Message Examples
```
fix: handle null user in auth middleware
feat: add CSV export for user reports  
refactor: extract payment logic to service
test: add integration tests for webhooks
docs: update API examples
```

## Decision Points

### When to Ask for Clarification
- Requirements are ambiguous
- Multiple valid approaches exist
- Changes affect core architecture
- Security implications unclear
- Performance requirements unspecified

### When to Proceed Autonomously
- Clear bug with obvious fix
- Following established patterns
- Simple refactoring with tests
- Documentation updates
- Adding tests to existing code

### When to Stop and Hand Off
- Need credentials or access
- Requires business decision
- Hit technical limitation
- Tests failing for unclear reasons
- Made 3+ attempts without progress