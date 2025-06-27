# Examples

## Quick Examples by Language/Domain

### Python - Data Analysis Bug
```
user: The CSV parser crashes on large files

assistant: I'll check the memory usage issue.
[tool_call: read_file path='data_parser.py']
[tool_call: search_file_content pattern='csv.*read|pandas.*read_csv']

Found it - loading entire file into memory. Here's the fix:
[tool_call: replace path='data_parser.py'
  old='df = pd.read_csv(filepath)'
  new='df = pd.read_csv(filepath, chunksize=10000)']

Now processes in 10k row chunks instead of loading 1GB+ files at once.
```

### Go - Microservice Auth
```
user: Add JWT validation to the API gateway

assistant: I'll add JWT middleware. First, checking existing auth:
[tool_call: glob pattern='**/*auth*.go']
[tool_call: read_file path='middleware/auth.go']

Adding JWT validation:
[tool_call: write_file path='middleware/jwt.go' content='package middleware

import (
    "net/http"
    "github.com/golang-jwt/jwt"
)

func ValidateJWT(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        // Validation logic here
        next.ServeHTTP(w, r)
    })
}']

Run `go mod tidy` to fetch the JWT package.
```

### Rust - Game Engine Performance  
```
user: The physics loop is dropping frames

assistant: Let me profile the physics system.
[tool_call: read_file path='src/physics/mod.rs']
[tool_call: search_file_content pattern='update.*loop|tick']

Found nested collision checks - O(n²). Implementing spatial partitioning:
[tool_call: replace path='src/physics/collision.rs'
  old='for a in &bodies {
    for b in &bodies {'
  new='let grid = SpatialGrid::new(&bodies);
for cell in grid.cells() {
    for (a, b) in cell.pairs() {']

This reduces collision checks by ~90% for 1000+ objects.
```

### JavaScript - React Form Validation
```
user: Form submits empty required fields

assistant: Checking form validation:
[tool_call: read_file path='components/UserForm.jsx']

Missing validation. Adding it:
[tool_call: replace path='components/UserForm.jsx'
  old='const handleSubmit = (e) => {
  e.preventDefault();
  onSubmit(formData);'
  new='const handleSubmit = (e) => {
  e.preventDefault();
  if (!formData.email || !formData.name) {
    setError("All fields required");
    return;
  }
  onSubmit(formData);']

Add error display: `{error && <span className="error">{error}</span>}`
```

### Java - Database Connection Leak
```
user: Getting "too many connections" errors in production

assistant: Checking connection handling:
[tool_call: search_file_content pattern='getConnection|close\(\)']
[tool_call: read_file path='src/main/java/db/UserDAO.java']

Connections not closed in catch block:
[tool_call: replace path='src/main/java/db/UserDAO.java'
  old='} catch (SQLException e) {
    throw new DAOException(e);
}'
  new='} catch (SQLException e) {
    throw new DAOException(e);
} finally {
    DBUtil.closeQuietly(conn);
}']

Use try-with-resources for automatic cleanup going forward.
```

### Ruby - Rails API Versioning
```
user: Need to version our API endpoints

assistant: I'll add API versioning. Checking routes:
[tool_call: read_file path='config/routes.rb']

Adding versioned namespace:
[tool_call: replace path='config/routes.rb'
  old='Rails.application.routes.draw do
  resources :users'
  new='Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      resources :users
    end
  end']

Move controllers to `app/controllers/api/v1/`. Old endpoints can redirect.
```

### C++ - Memory Leak
```
user: Valgrind shows memory leaks in the image processor

assistant: Let me find the leak:
[tool_call: search_file_content pattern='new|malloc|delete|free']
[tool_call: read_file path='src/ImageProcessor.cpp']

Found `new[]` without matching `delete[]`:
[tool_call: replace path='src/ImageProcessor.cpp'
  old='~ImageProcessor() {
    delete buffer;
}'
  new='~ImageProcessor() {
    delete[] buffer;  // Array delete for array allocation
}']

Consider using `std::vector` or smart pointers to prevent future leaks.
```

### SQL - Query Optimization
```
user: Report query times out after 30s

assistant: Let me analyze the slow query:
[tool_call: read_file path='queries/monthly_report.sql']

Missing indexes on JOIN columns:
[tool_call: write_file path='migrations/add_report_indexes.sql'
  content='CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_users_active ON users(id) WHERE active = true;']

Also consider materializing this view for faster reports.
```

## Key Patterns Demonstrated

1. **Concise responses** - Get to the point quickly
2. **Smart tool use** - Search before reading, read before writing  
3. **Context awareness** - Adapt to language idioms
4. **Problem focus** - Fix the specific issue asked
5. **Next steps** - Suggest one clear improvement