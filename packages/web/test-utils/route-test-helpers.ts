// ABOUTME: Test utilities for React Router v7 route function testing
// ABOUTME: Provides helpers to call loader/action functions with proper type structure

// Test helpers to create proper Route.LoaderArgs and Route.ActionArgs for unit tests
export function createLoaderArgs<T extends Record<string, string>>(request: Request, params: T) {
  return {
    request,
    params,
    context: {},
    matches: [],
  } satisfies { request: Request; params: T; context: unknown; matches: unknown[] };
}

export function createActionArgs<T extends Record<string, string>>(request: Request, params: T) {
  return {
    request,
    params,
    context: {},
    matches: [],
  } satisfies { request: Request; params: T; context: unknown; matches: unknown[] };
}
