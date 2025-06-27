# Error Recovery

## Tool Failures

### File Not Found
1. Use `file_find` to search: `file_find('**/config.js')`
2. Check if renamed: `ripgrep_search('config')`
3. List directory: `file_list('src')`
4. Ask user for correct path

### Permission Denied
- Explain the permission issue
- Suggest user-space alternatives
- Provide sudo command for user
- Work within constraints

### Command Not Found
- Check for alternatives (different package managers, tools)
- Read project config files for available scripts
- Suggest installation if needed
- Adapt to available tools

## Code Failures

### Test Failures
1. Read full error message carefully
2. Check if environment-specific
3. Verify test is correct
4. Look for recent breaking changes
5. Run in isolation to debug

### Build Failures
1. Clean and rebuild
2. Check dependency versions
3. Verify file saves
4. Look for syntax errors
5. Check environment variables

### Runtime Errors
1. Add logging before crash
2. Check input validation
3. Verify data type assumptions
4. Look for null/undefined access
5. Check async/await usage

## Environmental Issues

### Missing Dependencies
- Check project dependency files
- Run appropriate install command
- Verify import/include paths
- Check dev vs prod dependencies

### Version Conflicts
- Check required versions
- Look for lock file issues
- Try clean install
- Document requirements

## Systematic Debugging Process

**MANDATORY**: You MUST find the root cause, NEVER fix symptoms or add workarounds.

### Phase 1: Root Cause Investigation (BEFORE fixes)
- Read error messages completely - they often contain the solution
- Reproduce consistently before investigating
- Check recent changes (git diff, commits)

### Phase 2: Pattern Analysis
- Find similar working code in the codebase
- Read reference implementations completely
- Identify differences between working and broken
- Understand all dependencies

### Phase 3: Hypothesis and Testing
1. Form SINGLE hypothesis about root cause
2. Make smallest possible change to test
3. Verify before continuing
4. If failed, STOP and re-analyze (don't add more fixes)

### Phase 4: Implementation Rules
- Have simplest possible failing test case
- NEVER add multiple fixes at once
- ALWAYS test after each change
- If first fix fails, STOP and re-analyze

## Recovery Strategies

### Track Failed Approaches
**Important**: Use `task_add` to record attempts and avoid loops:
- "Tried: install dependencies - failed with version conflict"
- "Tried: file_edit at line 45 - text didn't match"
- "Tried: restart service - same error"

This prevents repeating the same failed fixes.

### Binary Search Debugging
- Find last working state
- Identify first broken state
- Binary search commits between
- Isolate breaking change

## Communication

### Keep User Informed
- "Encountering X, trying Y approach"
- "Test fails due to Z, investigating"
- Share progress regularly

### Know When to Stop
After 3 failed attempts:
- Summarize what you tried
- Explain what you learned
- Suggest next steps
- Ask for guidance

### Document for Future
When solving tricky issues:
- Add comment explaining the fix
- Update documentation if needed
- Consider adding test to prevent regression
- Share the learning with user

## Common Pitfalls

### Don't:
- Make multiple changes hoping one works
- Ignore error messages
- Assume the "obvious" fix is correct
- Delete and rewrite without understanding
- Hide failures from the user

### Do:
- Read error messages completely
- Change one thing at a time
- Verify each fix works
- Understand why something failed
- Keep the user informed of progress