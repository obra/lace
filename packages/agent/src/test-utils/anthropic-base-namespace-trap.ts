// ABOUTME: Throwing-mock factory for the Anthropic SDK base messages namespace.
// ABOUTME: Used by provider tests to detect regressions to client.messages.* (must be client.beta.messages.*)
//
// Chunk I (SDK observability) migrated AnthropicProvider onto
// client.beta.messages.{create,stream,countTokens}. The legacy
// client.messages.* namespace must NEVER be called from the provider on
// Anthropic-direct. These throwing stubs make any regression to the base
// namespace fail loudly inside the mock — silent vi.fn() stubs would pass
// against the wrong endpoint.

/**
 * Returns a `messages` object whose `create` and `stream` throw if invoked.
 * Drop this into the Anthropic SDK mock alongside a functional `beta.messages`
 * mock so tests fail loudly if the provider regresses to `client.messages.*`.
 */
export function anthropicBaseMessagesTrap(): {
  create: () => never;
  stream: () => never;
} {
  return {
    create: () => {
      throw new Error(
        'REGRESSION: client.messages.create called — must use client.beta.messages.create'
      );
    },
    stream: () => {
      throw new Error(
        'REGRESSION: client.messages.stream called — must use client.beta.messages.stream'
      );
    },
  };
}
