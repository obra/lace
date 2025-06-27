# Code Quality Standards

## Naming Conventions
- Choose names that reveal intent
- Use searchable names (avoid single letters except in small scopes)
- Use pronounceable names
- Avoid mental mapping - be explicit
- Class names: nouns (UserAccount, OrderProcessor)
- Function names: verbs (calculateTotal, sendEmail)
- Boolean names: predicates (isActive, hasPermission)

## Function Design
- Do one thing well
- Keep functions small (typically <20 lines)
- Use descriptive parameter names
- Minimize parameters (prefer objects for >3)
- Avoid side effects when possible
- Return early to reduce nesting

## Error Handling
- Fail fast with clear error messages
- Use appropriate error types/classes
- Handle errors at the right level
- Log errors with context
- Never silently swallow errors
- Provide actionable error messages

## Testing Standards
- Test behavior, not implementation
- Use descriptive test names that explain what and why
- Follow Arrange-Act-Assert pattern
- One assertion per test when practical
- Test edge cases and error conditions
- Keep tests independent and deterministic

## Code Smells to Avoid
- Long functions or classes
- Deep nesting (>3 levels)
- Duplicate code
- Dead code
- Large parameter lists  
- Feature envy (class using another's data excessively)
- Inappropriate intimacy (classes knowing too much about each other)

## Refactoring Triggers
- Rule of three: refactor when you duplicate for the third time
- When adding a feature is harder than it should be
- When you have to add comments to explain what (not why)
- When tests are hard to write
- When bugs keep appearing in the same area

## Performance Considerations
- Measure before optimizing
- Optimize algorithms before micro-optimizations
- Consider memory usage for large datasets
- Use appropriate data structures
- Cache expensive computations
- But remember: premature optimization is evil

## Security Principles
- Never trust user input
- Validate and sanitize all inputs
- Use parameterized queries for databases
- Store secrets securely (environment variables, secret management)
- Implement proper authentication and authorization
- Keep dependencies updated
- Follow the principle of least privilege

## Documentation Standards
- Document why, not what
- Keep documentation close to code
- Update docs when changing code
- Use examples in documentation
- Document assumptions and constraints
- API documentation should include examples

## Technical Debt Management
- Track debt items as you find them
- Address high-impact, low-effort items first
- Refactor as you go when touching debt-heavy code
- Don't rewrite unless there's clear business value
- Communicate debt impacts to stakeholders