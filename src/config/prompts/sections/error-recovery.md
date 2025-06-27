# Error Recovery

## Tool Failure Recovery

### File Not Found
```
Error: File 'src/config.js' not found
Recovery:
1. Use glob to find similar files: glob('**/config.js')
2. Check if file was renamed: search_file_content('config')
3. List directory to verify path: list_directory('src')
4. Ask user for correct location
```

### Permission Denied
```
Error: Permission denied: '/etc/hosts'
Recovery:
1. Explain why permission was denied
2. Suggest alternatives (user-space configs)
3. Provide sudo command for user to run
4. Work within permission constraints
```

### Command Not Found
```
Error: Command 'yarn' not found
Recovery:
1. Check for alternatives (npm, pnpm)
2. Read package.json for scripts
3. Suggest installation command
4. Adapt workflow to available tools
```

## Code Failure Recovery

### Test Failures
```
When tests fail:
1. Read the full error message
2. Check if it's environment-specific
3. Verify test is testing the right thing
4. Look for recent changes that might have broken it
5. Run in isolation to rule out interference
```

### Build Failures
```
When builds fail:
1. Clean build artifacts and retry
2. Check dependency versions
3. Verify all files are saved
4. Look for syntax errors in recent changes
5. Check environment variables
```

### Runtime Errors
```
When code crashes:
1. Add logging before the crash point
2. Check input validation
3. Verify assumptions about data types
4. Look for null/undefined access
5. Check async/await usage
```

## Environmental Issues

### Missing Dependencies
```
Recognition: Import errors, module not found
Recovery:
1. Check package.json for dependency
2. Run install command
3. Verify correct import path
4. Check if it's a dev dependency
```

### Version Conflicts  
```
Recognition: Peer dependency warnings, API mismatches
Recovery:
1. Check required versions in package.json
2. Look for lock file conflicts
3. Try clean install
4. Document version requirements
```

### Platform Differences
```
Recognition: Works locally but not in CI, path separator issues
Recovery:
1. Use platform-agnostic approaches
2. Check for OS-specific code
3. Verify file case sensitivity
4. Test with cross-platform tools
```

## Recovery Strategies

### The Scientific Method
```
1. Observe: What exactly is happening?
2. Hypothesize: What might cause this?
3. Test: Change ONE thing
4. Measure: Did it fix the issue?
5. Iterate: If not, form new hypothesis
```

### Binary Search Debugging
```
When something used to work:
1. Find last known good state
2. Identify first broken state
3. Binary search the commits between
4. Isolate the breaking change
```

### Isolation Testing
```
When complex systems fail:
1. Test components in isolation
2. Add one integration at a time
3. Identify where it breaks
4. Focus debugging on that integration
```

## Communication During Failures

### Keep User Informed
```
"I'm encountering an issue with X. Let me try Y approach."
"The test is failing due to Z. I'll investigate further."
"This seems to be an environment issue. Can you verify A?"
```

### Know When to Stop
```
After 3 failed attempts:
- Summarize what you've tried
- Explain what you've learned
- Suggest next steps
- Ask for guidance
```

### Document for Future
```
When you solve a tricky issue:
- Add comment explaining the fix
- Update documentation if needed
- Consider adding a test to prevent regression
- Share the learning with the user
```

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