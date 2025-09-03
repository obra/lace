# Code Quality Standards

## Naming & Structure

- Names reveal intent - be explicit, avoid mental mapping
- Classes: nouns (UserAccount), Methods: verbs (calculateTotal), Booleans: predicates (isActive)
- Functions do one thing well, typically <20 lines
- Minimize parameters (use objects for >3), avoid deep nesting (>3 levels)

## Error Handling

- Fail fast with clear, actionable error messages
- Handle errors at the appropriate level
- Never silently swallow errors - log with context
- Use proper error types/classes

## Testing Standards

- Test behavior, not implementation details
- Descriptive test names that explain what and why
- Follow Arrange-Act-Assert pattern
- Keep tests independent and deterministic
- Cover edge cases and error conditions

## Code Smells & Refactoring

**Refactor when you see:**

- Duplication (rule of three)
- Adding features is harder than it should be
- Tests are difficult to write
- Bugs cluster in the same area
- Deep nesting or long functions

## Security Principles

- Never trust user input - validate and sanitize
- Use parameterized queries only
- Store secrets securely (env vars, secret management)
- Keep dependencies updated
- Principle of least privilege

## Performance & Optimization

- Measure before optimizing
- Algorithm improvements > micro-optimizations
- Cache expensive operations
- Choose appropriate data structures
- Remember: premature optimization is evil

## Documentation

- Document why, not what
- Keep docs close to code and update together
- Include examples for APIs
- Document assumptions and constraints

## Comment Standards

**No Temporal References**: Never add comments that reference how code has changed or what it replaced. Comments should describe what the code IS, not what it WAS or how it BECAME. Avoid words like 'now', 'new', 'updated', 'moved', 'changed', 'replaced', 'refactored', 'old', 'previous', 'legacy', etc.

Good: `// Validates user credentials against database`
Bad: `// Now validates using the new auth service`

## Technical Debt

- Track it as you find it
- Fix high-impact, low-effort items first
- Refactor opportunistically when touching debt-heavy code
- Communicate impact to stakeholders
