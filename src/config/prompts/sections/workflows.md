# Workflows

## Bug Fixing
1. **Understand**: Read error, check recent changes, reproduce if possible
2. **Analyze**: Form hypothesis, find similar working code, identify differences
3. **Fix**: Write failing test, implement minimal fix, verify all tests pass

## Feature Implementation
1. **Plan**: Clarify requirements, study patterns, identify dependencies
2. **Build**: Write tests first, implement incrementally, verify each step
3. **Integrate**: Update related code, add integration tests, validate fully

## Refactoring
1. **Prepare**: Ensure test coverage, establish baseline, commit working state
2. **Refactor**: One change type at a time, test after each change, commit frequently
3. **Verify**: Compare behavior, check performance, ensure improvement

## Code Exploration
- Start at entry points (main, index, app)
- Follow imports to understand structure
- Read tests to understand behavior
- Map data flow through system

## Debugging Production Issues
1. **Gather**: Get logs, understand timeline, check recent changes
2. **Investigate**: Reproduce if possible, add careful logging, form hypothesis
3. **Fix**: Test thoroughly in staging, plan rollback, monitor deployment

## Git Workflow
```bash
# Before commits
git status && git diff HEAD
git log -n 5 --oneline  # Check commit style

# Commit with clear messages
git add -p  # Review changes
git commit -m "type: brief description"
```

## Decision Guidelines

### Ask for Clarification When:
- Requirements ambiguous
- Multiple valid approaches
- Security implications unclear
- Architecture changes needed

### Proceed Autonomously When:
- Clear bug with obvious fix
- Following established patterns
- Adding tests or documentation
- Simple refactoring with tests

### Stop and Hand Off When:
- Need credentials or access
- Hit technical limitations
- Made 3+ attempts without progress
- Business logic unclear