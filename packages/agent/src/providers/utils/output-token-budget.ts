// ABOUTME: Fits a request's output-token limit into the room the input leaves in the context window,
// ABOUTME: for gateways that reject any request whose input + max output exceeds the window.

/**
 * How far to scale lace's input estimate up before subtracting it from the window, when
 * nothing has measured this turn's real input yet (its first hop, or a reply with no
 * usage).
 *
 * The estimate is characters / 4 over text (`estimateProviderTokens`). Real coworker
 * content measures 2.4–2.9 characters per token (see `estimateUndercountRatio` in
 * compaction/toolkit.ts, measured with the Anthropic tokenizer; DeepSeek's is
 * unmeasured), so true input runs 1.38–1.67× the estimate. 1.7 covers that range.
 * Anything it still misses fails safe: the gateway's overflow 400 is classified as
 * context_window_exceeded and triggers emergency compaction.
 */
export const INPUT_ESTIMATE_UNDERCOUNT_FACTOR = 1.7;

/**
 * Headroom on top of a ratio the previous hop measured. The next hop's new content (tool
 * results, the model's own output) can tokenize denser than the history the ratio was
 * measured on, so the ratio is a good guide but not an exact one. 10% absorbs that
 * hop-to-hop drift without falling back to the blanket 1.7, which on content that
 * chars/4 already estimates well would pin output to the floor at ~60% of the window,
 * long before compaction runs.
 */
export const MEASURED_RATIO_MARGIN = 1.1;

/**
 * The smallest output limit we send once the window is (nearly) full. Sending something
 * rather than zero lets the request go through when the projection was pessimistic, and
 * when it wasn't, the gateway's overflow error is what starts emergency compaction.
 */
export const MIN_OUTPUT_TOKENS = 4096;

/**
 * The input size to plan around: the estimate scaled by the ratio the previous call in
 * this turn actually measured (its real input tokens over its estimate) plus a margin,
 * or by the fixed undercount factor when there is no measurement. Scaling by a ratio,
 * rather than reusing the last real count as-is, stays right when history shrinks
 * between calls, as after an emergency compaction.
 */
export function projectInputTokens(estimatedInputTokens: number, measuredRatio?: number): number {
  const factor =
    measuredRatio === undefined
      ? INPUT_ESTIMATE_UNDERCOUNT_FACTOR
      : measuredRatio * MEASURED_RATIO_MARGIN;
  return Math.ceil(estimatedInputTokens * factor);
}

export function fitOutputTokensToContextWindow(opts: {
  requestedOutputTokens: number;
  contextWindow: number;
  projectedInputTokens: number;
}): number {
  const room = opts.contextWindow - opts.projectedInputTokens;
  const floor = Math.min(opts.requestedOutputTokens, MIN_OUTPUT_TOKENS);
  return Math.max(floor, Math.min(opts.requestedOutputTokens, room));
}
