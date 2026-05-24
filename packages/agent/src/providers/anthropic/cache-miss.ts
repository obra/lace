// ABOUTME: Discriminated union mirroring @anthropic-ai/sdk's BetaDiagnostics.cache_miss_reason
// ABOUTME: SDK 0.98.0 exports the individual variants but no named union — we build one here

import type {
  BetaCacheMissModelChanged,
  BetaCacheMissSystemChanged,
  BetaCacheMissToolsChanged,
  BetaCacheMissMessagesChanged,
  BetaCacheMissPreviousMessageNotFound,
  BetaCacheMissUnavailable,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

/**
 * The discriminated union of cache-miss reasons returned by the Anthropic
 * cache-diagnosis-2026-04-07 beta. Mirrors the shape of
 * `BetaDiagnostics.cache_miss_reason` from `@anthropic-ai/sdk@0.98.0`. The SDK
 * exports each variant interface individually but no named union — we name it
 * here so the rest of the codebase has a single canonical type to reference.
 *
 * Discriminator: `type`. Variants that have a comparable prefix carry the
 * approximate `cache_missed_input_tokens` count of bytes that would have been
 * served from cache had the prefix matched. Variants without a comparable
 * prefix (`previous_message_not_found`, `unavailable`) omit that field.
 */
export type BetaCacheMissReason =
  | BetaCacheMissModelChanged
  | BetaCacheMissSystemChanged
  | BetaCacheMissToolsChanged
  | BetaCacheMissMessagesChanged
  | BetaCacheMissPreviousMessageNotFound
  | BetaCacheMissUnavailable;
