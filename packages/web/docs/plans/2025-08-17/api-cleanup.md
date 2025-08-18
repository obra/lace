# API Error Handling Cleanup Plan

## Problem

Our codebase has inconsistent API error handling patterns that can cause crashes when servers return HTML error pages instead of JSON. The current pattern allows developers to accidentally parse response bodies before checking `res.ok`, leading to JSON parsing errors.

### Current Problematic Pattern
```typescript
// BROKEN - parses HTML error pages as JSON
const data = await parseResponse(response);
if (!response.ok || isApiError(data)) {
  // Too late - JSON.parse() already threw on HTML error page
}
```

### Audit Results
Agent audit identified 7 files with this pattern:
1. `useAgentTokenUsage.ts` 
2. `useAgentManagement.ts`
3. `useSessionManagement.ts` 
4. `useProviders.ts`
5. `useProjectManagement.ts`
6. `useProviderStatus.ts`
7. `ProviderInstanceProvider.tsx`

## Solution

Instead of fixing each file individually, we're implementing two complementary solutions:

1. **Centralized API client** that makes it impossible to get error handling wrong
2. **Clean serialization module split** to separate client/server concerns

### New API Client (`lib/api-client.ts`)

```typescript
export const api = {
  get: <T>(url: string, options?) => Promise<T>,
  post: <T>(url: string, body?, options?) => Promise<T>,
  put: <T>(url: string, body?, options?) => Promise<T>,
  delete: <T>(url: string, options?) => Promise<T>,
}
```

### Enforced Error Handling Flow
1. **Check HTTP status first** - `if (!response.ok) throw immediately`
2. **Parse only on success** - Never parse HTML error pages
3. **Check business logic errors** - Use `isApiError()` after parsing

### Benefits
- **Impossible to get wrong** - Single code path enforces correct pattern
- **Zero cognitive load** - Just use `api.get()`, `api.post()`, etc.
- **Consistent error messages** - All HTTP and API errors become Error objects
- **Type safety** - Full TypeScript support maintained
- **Future-proof** - New developers can't introduce the anti-pattern

## Migration Plan

### Phase 1: Replace Direct Usage
Convert all identified files from manual fetch() + parseResponse() to api.* methods:

**Before:**
```typescript
const response = await fetch(`/api/agents/${agentId}`);
const data = await parseResponse<AgentInfo>(response);
if (!response.ok) { /* broken */ }
```

**After:**
```typescript
const data = await api.get<AgentInfo>(`/api/agents/${agentId}`);
```

### Phase 2: Update Hook Patterns
Transform complex error handling in hooks:

**Before:**
```typescript
try {
  const response = await fetch(url);
  const data = await parseResponse<T>(response);
  if (!response.ok || isApiError(data)) {
    const message = isApiError(data) ? data.error : `Failed: ${response.status}`;
    throw new Error(message);
  }
  return data;
} catch (error) {
  setError(error.message);
  return null;
}
```

**After:**
```typescript
try {
  return await api.get<T>(url);
} catch (error) {
  setError(error.message);
  return null;
}
```

### Phase 3: Split Serialization Modules
Create clean separation between client and server serialization:

1. **Create `lib/server/serialization.ts`** - Server-only helpers
   - Move `createSuperjsonResponse` with NextResponse import
   - Import base utilities from `../serialization`

2. **Clean up `lib/serialization.ts`** - Universal client/server
   - Remove NextResponse import (client bundle issue)
   - Keep parseResponse, parseTyped, stringify, etc.
   - Remove unused internal helpers

3. **Update API route imports** 
   - Change from `lib/serialization` to `lib/server/serialization`
   - Ensure all API routes use server-specific module

### Phase 4: Prevent Future Issues
- Add ESLint rule to prevent direct `fetch()` usage in favor of `api.*`
- Add ESLint rule to prevent client code importing from `lib/server/*`
- Update code review guidelines to require API client usage
- Add documentation examples using the new pattern

## Files to Update

1. **hooks/useAgentTokenUsage.ts** - Replace parseResponse pattern with api.get
2. **hooks/useAgentManagement.ts** - Convert all CRUD operations to api.* methods  
3. **hooks/useSessionManagement.ts** - Replace manual fetch with api.* calls
4. **hooks/useProviders.ts** - Convert provider API calls to use api client
5. **hooks/useProjectManagement.ts** - Replace project API calls with api.* methods
6. **hooks/useProviderStatus.ts** - Convert status checks to api.get
7. **components/providers/ProviderInstanceProvider.tsx** - Replace fetch calls with api.*

## Success Criteria

### API Client Migration
- [ ] All 7 identified files migrated to api.* methods
- [ ] No direct `fetch()` + `parseResponse()` patterns remain
- [ ] All hooks use consistent error handling via api client

### Serialization Module Split  
- [ ] `lib/server/serialization.ts` created with NextResponse helpers
- [ ] `lib/serialization.ts` cleaned of server-only imports
- [ ] All API routes updated to import from server module
- [ ] Client bundles no longer include NextResponse

### Quality Assurance
- [ ] All tests passing after migration
- [ ] TypeScript compilation clean
- [ ] Error handling is consistent across all API calls
- [ ] Future developers cannot introduce the anti-pattern
- [ ] ESLint rules prevent incorrect patterns

## Implementation Notes

- Maintain existing AbortSignal support via options parameter
- Preserve custom headers and request options
- Ensure superjson serialization continues to work
- Keep existing error message formats for compatibility
- Test with both HTTP errors (404, 500) and API business logic errors

This refactoring eliminates an entire class of potential bugs while simplifying the codebase and reducing cognitive load for developers.