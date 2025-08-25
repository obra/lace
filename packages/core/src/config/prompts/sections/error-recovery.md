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
- NEVER attempt multiple changes to fix something at the same time
- ALWAYS test after each change
- If first fix fails, STOP and re-analyze

### Binary Search Debugging (git bisect)

- Find last working state
- Identify first broken state
- Binary search commits between
- Isolate breaking change

## Communication

### Know When to Stop

After 3 failed attempts:

- Summarize what you tried
- Explain what you learned
- Suggest next steps
- Ask for guidance

### Document for Future

When solving tricky issues:

- Add comment explaining the fix
- Update documentation if relevant
- Add tests to prevent regression unless you have a strong reason not to
- Share the learning with your partner

## Common Pitfalls

### Don't:

- Make multiple changes hoping one works
- Ignore error messages
- Assume the "obvious" fix is correct
- Delete and rewrite without understanding
- Hide failures from your partner

### Do:

- Change one thing at a time
- Verify each fix works
- Understand why something failed
- Keep your partner informed of progress (briefly)
