# Workflows

## Test-Driven Development (MANDATORY)

**NO EXCEPTIONS**: ALL features and bug fixes MUST follow TDD:
1. Write a failing test that validates the desired functionality
2. Run the test to confirm it fails as expected
3. Write ONLY enough code to make the test pass
4. Run the test to confirm success
5. Refactor if needed while keeping tests green

**Testing Requirements**:
- ALL projects MUST have unit tests, integration tests, AND end-to-end tests
- NEVER write tests that test mocked behavior
- NEVER use mocks in end-to-end tests
- Test output MUST be pristine to pass

## Bug Fixing
1. **Understand**: Read error, check recent changes, reproduce if possible
2. **Analyze**: Form hypothesis, find similar working code, identify differences
3. **Fix**: Write failing test FIRST, implement minimal fix, verify all tests pass

## Feature Implementation
1. **Plan**: Clarify requirements, study patterns, identify dependencies
2. **Build**: Write tests FIRST, implement incrementally, verify each step
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

## Version Control (MANDATORY CHECKS)

**Before Starting Work**:
- MUST check for uncommitted changes or untracked files
- MUST ask how to handle them (suggest committing first)
- MUST create a WIP branch if no clear branch exists
- MUST track all non-trivial changes in git
- NEVER skip, evade, or disable pre-commit hooks

## Git Workflow
```bash
# REQUIRED: Check status before starting
git status  # STOP and ask if uncommitted changes exist

# Before commits
git diff HEAD
git log -n 5 --oneline  # Check commit style

# Commit frequently with clear messages
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