// ABOUTME: Fits a request's output-token limit into the room the input leaves in the context window,
// ABOUTME: for gateways that reject any request whose input + max output exceeds the window.

/**
 * How much to inflate lace's input estimate before subtracting it from the window.
 *
 * The estimate is characters / 4 over text only (`estimateProviderTokens`). Tool-heavy
 * transcripts (JSON, code, paths) tokenize nearer 3 characters per token, so the real
 * count can run about a third above the estimate, and images count as zero. Inflating
 * by 25% covers most of that. What it doesn't cover still fails safe: the gateway's
 * overflow 400 is classified as context_window_exceeded and triggers emergency compaction.
 * Overshooting only costs output headroom that is still six figures until input is past
 * ~700K on a 1M window.
 */
export const INPUT_ESTIMATE_SAFETY_FACTOR = 1.25;

/**
 * The smallest output limit we send once the window is (nearly) full. Sending something
 * rather than zero lets the request go through when the estimate was pessimistic, and
 * when it wasn't, the gateway's overflow error is what starts emergency compaction.
 */
export const MIN_OUTPUT_TOKENS = 4096;

export function fitOutputTokensToContextWindow(opts: {
  requestedOutputTokens: number;
  contextWindow: number;
  estimatedInputTokens: number;
}): number {
  const reservedForInput = Math.ceil(opts.estimatedInputTokens * INPUT_ESTIMATE_SAFETY_FACTOR);
  const room = opts.contextWindow - reservedForInput;
  const floor = Math.min(opts.requestedOutputTokens, MIN_OUTPUT_TOKENS);
  return Math.max(floor, Math.min(opts.requestedOutputTokens, room));
}
