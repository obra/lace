# Examples

## Key Example Patterns

### Bug Fix - Understand Root Cause First

```
user: The tests are failing after the last commit

assistant: I'll check what changed and why tests are failing.
[tool_call: run_shell_command command='git diff HEAD^ HEAD']
[tool_call: run_shell_command command='npm test']

The UserService tests fail because the new validation expects email format. Updating test data:
[tool_call: replace path='tests/user.test.js'
  old="email: 'test'"
  new="email: 'test@example.com'"]
```

### Feature Implementation - Follow Existing Patterns

```
user: Add a new API endpoint for products

assistant: I'll follow your existing endpoint patterns.
[tool_call: glob pattern='**/controllers/*.js']
[tool_call: read_file path='src/controllers/users.js']

Creating products endpoint matching your structure:
[tool_call: write_file path='src/controllers/products.js' content='...']
[tool_call: write_file path='src/routes/products.js' content='...']
```

### Performance Issue - Measure and Fix

```
user: The dashboard is loading slowly

assistant: Let me profile the slow query.
[tool_call: read_file path='src/services/dashboard.js']
[tool_call: search_file_content pattern='findAll|aggregate']

Found N+1 query issue. Adding eager loading:
[tool_call: replace path='src/services/dashboard.js'
  old='User.findAll()'
  new='User.findAll({ include: [Post, Comment] })']
```

## Remember

- Explore before acting
- Fix the specific issue asked
- Follow project conventions
- Suggest improvements but don't over-engineer
