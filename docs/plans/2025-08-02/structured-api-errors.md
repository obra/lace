# Structured API Error System Implementation Plan

## Executive Summary

Based on the comprehensive audit of our 23 API routes, we have a solid foundation for error handling but need to enhance it with structured error types, better debugging context, and complete standardization. This plan outlines the implementation of a robust, client-friendly structured error system.

## Current State Analysis

### ✅ Strengths
- **Consistent structure**: All errors follow `{ error: string, details?: unknown }` format
- **Type safety**: Strong TypeScript typing with `ApiErrorResponse` interface  
- **Proper HTTP status codes**: 400, 404, 500 used appropriately
- **Superjson integration**: All responses use `createSuperjsonResponse`
- **Helper functions exist**: `createErrorResponse` available but underutilized (only 3/23 routes use it)
- **Validation handling**: Good Zod integration with detailed validation errors

### 🔧 Areas for Improvement
- **Missing semantic error codes**: Only HTTP status codes, no application-level error classification
- **Inconsistent debugging context**: Some routes lose original error details
- **Helper function adoption**: Only task management routes use `createErrorResponse` 
- **No correlation IDs**: Difficult to trace errors across the system
- **Limited structured context**: Missing request context, user info, operation context

## Proposed Structured Error System

### Enhanced ApiError Interface

```typescript
// Enhanced structured error response
export interface ApiErrorResponse {
  error: string;                    // Human-readable error message
  code: ApiErrorCode;              // Semantic error code for client handling
  details?: unknown;               // Additional error details (validation errors, etc.)
  context?: ApiErrorContext;       // Debugging and tracing context
  timestamp: string;               // ISO timestamp when error occurred
}

// Semantic error codes for better client-side error handling
export type ApiErrorCode = 
  // Resource errors
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_CONFLICT' 
  | 'RESOURCE_FORBIDDEN'
  // Validation errors  
  | 'VALIDATION_FAILED'
  | 'INVALID_INPUT'
  | 'MISSING_REQUIRED_FIELD'
  // Authentication/Authorization
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_PERMISSIONS'
  // System errors
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'DATABASE_ERROR'
  | 'EXTERNAL_SERVICE_ERROR'
  // Business logic errors
  | 'OPERATION_FAILED' 
  | 'BUSINESS_RULE_VIOLATION'
  | 'CONCURRENT_MODIFICATION';

// Enhanced debugging context
export interface ApiErrorContext {
  requestId: string;               // Unique request identifier for tracing
  operation?: string;              // Operation being performed
  resource?: {                     // Resource context
    type: string;                  // e.g., 'project', 'session', 'task'
    id: string;                    // Resource identifier  
  };
  validation?: {                   // Validation error details
    field: string;
    expected: string;
    received: unknown;
  }[];
  originalError?: {                // Original error context (in development)
    message: string;
    stack?: string;
  };
}

// Client-friendly error classification
export type ApiErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

// Enhanced error response with severity
export interface DetailedApiErrorResponse extends ApiErrorResponse {
  severity: ApiErrorSeverity;
  retryable: boolean;              // Whether client should retry
  retryAfter?: number;             // Seconds to wait before retry
}
```

### Enhanced Helper Functions

```typescript
// Enhanced error creation helpers
export function createStructuredError(
  message: string,
  code: ApiErrorCode,
  status: number,
  options?: {
    details?: unknown;
    context?: Partial<ApiErrorContext>;
    severity?: ApiErrorSeverity;
    retryable?: boolean;
    retryAfter?: number;
    originalError?: unknown;
  }
): Response {
  const requestId = generateRequestId();
  
  const errorResponse: DetailedApiErrorResponse = {
    error: message,
    code,
    timestamp: new Date().toISOString(),
    details: options?.details,
    context: {
      requestId,
      ...options?.context,
      ...(options?.originalError && process.env.NODE_ENV === 'development' && {
        originalError: {
          message: options.originalError instanceof Error ? options.originalError.message : String(options.originalError),
          stack: options.originalError instanceof Error ? options.originalError.stack : undefined,
        }
      })
    },
    severity: options?.severity ?? 'medium',
    retryable: options?.retryable ?? false,
    retryAfter: options?.retryAfter,
  };
  
  // Structured logging
  logger.error(`API Error: ${message}`, {
    requestId,
    code,
    status,
    severity: options?.severity,
    context: options?.context,
    originalError: options?.originalError,
  });
  
  return createSuperjsonResponse(errorResponse, { status });
}

// Specialized helper functions for common patterns
export function createValidationError(
  validationErrors: z.ZodError['errors'],
  requestId?: string
): Response {
  return createStructuredError(
    'Request validation failed',
    'VALIDATION_FAILED',
    400,
    {
      details: validationErrors,
      context: {
        requestId: requestId ?? generateRequestId(),
        validation: validationErrors.map(err => ({
          field: err.path.join('.'),
          expected: err.message,
          received: err.input
        }))
      },
      severity: 'low',
      retryable: false,
    }
  );
}

export function createNotFoundError(
  resourceType: string,
  resourceId: string,
  requestId?: string
): Response {
  return createStructuredError(
    `${resourceType} not found`,
    'RESOURCE_NOT_FOUND',
    404,
    {
      context: {
        requestId: requestId ?? generateRequestId(),
        resource: { type: resourceType.toLowerCase(), id: resourceId },
      },
      severity: 'low',
      retryable: false,
    }
  );
}

export function createInternalError(
  message: string,
  originalError?: unknown,
  context?: Partial<ApiErrorContext>
): Response {
  return createStructuredError(
    message,
    'INTERNAL_SERVER_ERROR',
    500,
    {
      context,
      originalError,
      severity: 'high',
      retryable: true,
      retryAfter: 5,
    }
  );
}
```

## Implementation Plan

### Phase 1: Foundation Setup
**Timeline: 1-2 hours**

1. **Enhance core types** (`types/api.ts`)
   - Add `ApiErrorCode` enum
   - Add `ApiErrorContext` interface  
   - Add `DetailedApiErrorResponse` interface
   - Maintain backward compatibility with existing `ApiErrorResponse`

2. **Enhance api-utils.ts**
   - Add structured error helper functions
   - Add request ID generation utility
   - Add enhanced logging with structured context
   - Keep existing `createErrorResponse` for backward compatibility

3. **Add test utilities**
   - Helper functions for testing structured errors
   - Mock request ID generation for tests

### Phase 2: Systematic Migration
**Timeline: 2-3 hours**

**Priority 1: Core API Routes (High Traffic)**
- `app/api/sessions/` routes (4 files)
- `app/api/projects/` routes (2 files) 
- `app/api/threads/` routes (2 files)

**Priority 2: Resource Management Routes**
- Project management routes (8 files)
- Session management routes (3 files)
- Agent management routes (2 files)

**Priority 3: Specialized Routes**
- Task management routes (4 files)
- Provider routes (1 file)
- Event streaming route (1 file)

### Phase 3: Testing & Validation
**Timeline: 1-2 hours**

1. **Update all test files**
   - Modify response parsing to handle enhanced structure
   - Add tests for new error codes and context
   - Verify backward compatibility

2. **Integration testing**
   - Test error responses across all routes
   - Verify error codes are consistent
   - Test error context is populated correctly

3. **Client-side updates**
   - Update error handling in hooks and components
   - Add error code-specific handling where beneficial
   - Improve error user experience

### Phase 4: Monitoring & Observability
**Timeline: 1 hour**

1. **Enhanced logging**
   - Structured error logs with correlation IDs
   - Error metrics and alerting
   - Request tracing improvements

2. **Documentation**
   - Update API documentation with error codes
   - Add error handling best practices
   - Document new error response structure

## Migration Strategy

### Backward Compatibility
- Keep existing `ApiErrorResponse` interface  
- New `DetailedApiErrorResponse` extends the base interface
- Existing clients continue to work unchanged
- New clients can opt into richer error handling

### Rollout Approach
1. **Non-breaking enhancement**: Add new fields as optional
2. **Gradual adoption**: Migrate routes one by one
3. **Test coverage**: Ensure all changes have test coverage
4. **Monitoring**: Track error patterns before and after migration

### Error Code Mapping Strategy

| HTTP Status | Current Pattern | New Error Code | Use Cases |
|-------------|----------------|----------------|-----------|
| 400 | "Invalid request data" | `VALIDATION_FAILED` | Zod validation failures |
| 400 | "Invalid JSON" | `INVALID_INPUT` | JSON parsing errors |
| 404 | "Project not found" | `RESOURCE_NOT_FOUND` | Resource lookup failures |
| 404 | "Session not found" | `RESOURCE_NOT_FOUND` | Session lookup failures |
| 500 | "Internal server error" | `INTERNAL_SERVER_ERROR` | Unexpected errors |
| 500 | "Database error" | `DATABASE_ERROR` | Database operation failures |

## Success Metrics

### Technical Metrics
- **100% API route coverage** with structured errors
- **Zero breaking changes** for existing clients
- **Improved error context** in all error responses
- **Consistent error codes** across similar operations

### Developer Experience Metrics  
- **Faster debugging** through correlation IDs and context
- **Better client error handling** through semantic error codes
- **Reduced support tickets** from unclear error messages
- **Enhanced monitoring** through structured error logs

## Risk Mitigation

### Potential Risks
1. **Breaking changes**: Accidental incompatibility with existing clients
2. **Performance impact**: Additional error processing overhead
3. **Inconsistent adoption**: Some routes using old patterns

### Mitigation Strategies
1. **Comprehensive testing**: Test all error paths with both old and new clients
2. **Performance monitoring**: Benchmark error handling performance
3. **Code review process**: Ensure consistent adoption of new patterns
4. **Rollback plan**: Keep old helper functions available for quick rollback

## Implementation Priority

### Immediate (High Impact, Low Risk)
- ✅ Fix magic regex in serialization.ts (COMPLETED)
- Enhance `types/api.ts` with structured error interfaces
- Add structured error helpers to `lib/server/api-utils.ts`

### Next (High Impact, Medium Risk)
- Migrate core session and project routes to structured errors
- Update tests to handle enhanced error structure
- Add request ID generation and correlation

### Future (Medium Impact, Low Risk)
- Migrate remaining routes to structured errors
- Add client-side error code handling
- Implement error monitoring and alerting

This structured approach will significantly improve our API error handling while maintaining backward compatibility and providing a clear migration path.