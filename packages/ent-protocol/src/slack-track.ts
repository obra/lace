/**
 * Canonical Slack conversation-track helper.
 *
 * Grammar (label-free):
 *   slack:<teamId>:<channelId>            # channel-level conversation
 *   slack:<teamId>:<channelId>/<threadTs> # threaded conversation
 *
 * Design notes:
 * - Label-FREE on purpose: channel labels are display-only and mutable
 *   (renames make label-keyed tracks unstable). Do NOT include a `|label`.
 * - This is a CONVERSATION key, NOT a per-message ref.
 *   Per-message refs (formatSlackMessageRef in sen-core-v2) use `|label@msgTs`
 *   suffixes and are a different type — do not conflate them.
 * - Parsing assumptions (Slack IDs do not contain ':' or '/'):
 *   - teamId   = segment between "slack:" and the next ":"
 *   - channelId = segment between the second ":" and the first "/" (or end of string)
 *   - threadTs  = segment after the first "/" (if present)
 *   Any segment that contains ':' or '/' in teamId/channelId, or '/' in threadTs,
 *   is rejected at format time and will not round-trip.
 */

export interface SlackConvTrackParts {
  teamId: string;
  channelId: string;
  threadTs?: string;
}

const SLACK_PREFIX = 'slack:';

/**
 * Format a Slack conversation-track key from its constituent parts.
 *
 * @throws {Error} if teamId or channelId are empty/whitespace, or if any
 *   segment contains characters that would break the grammar (':' in teamId
 *   or channelId, '/' in channelId or threadTs).
 */
export function formatSlackConvTrack(parts: SlackConvTrackParts): string {
  const { teamId, channelId, threadTs } = parts;

  if (!teamId || !teamId.trim()) {
    throw new Error('formatSlackConvTrack: teamId must not be empty');
  }
  if (!channelId || !channelId.trim()) {
    throw new Error('formatSlackConvTrack: channelId must not be empty');
  }
  if (teamId.includes(':')) {
    throw new Error(`formatSlackConvTrack: teamId must not contain ':' (got: ${teamId})`);
  }
  if (channelId.includes(':')) {
    throw new Error(`formatSlackConvTrack: channelId must not contain ':' (got: ${channelId})`);
  }
  if (channelId.includes('/')) {
    throw new Error(`formatSlackConvTrack: channelId must not contain '/' (got: ${channelId})`);
  }

  if (threadTs !== undefined) {
    if (threadTs.includes('/')) {
      throw new Error(`formatSlackConvTrack: threadTs must not contain '/' (got: ${threadTs})`);
    }
    return `${SLACK_PREFIX}${teamId}:${channelId}/${threadTs}`;
  }

  return `${SLACK_PREFIX}${teamId}:${channelId}`;
}

/**
 * Parse a Slack conversation-track key back into its constituent parts.
 *
 * Returns null for:
 * - non-`slack:` prefix
 * - missing or empty teamId / channelId segments
 * - empty threadTs when a '/' separator is present
 * - strings containing '|' (per-message ref label suffix) or '@' (msgTs marker)
 */
export function parseSlackConvTrack(track: string): SlackConvTrackParts | null {
  if (!track.startsWith(SLACK_PREFIX)) {
    return null;
  }

  // Reject per-message ref markers immediately
  if (track.includes('|') || track.includes('@')) {
    return null;
  }

  // Everything after "slack:"
  const body = track.slice(SLACK_PREFIX.length);
  if (!body) {
    return null;
  }

  // Split into teamId:rest
  const firstColon = body.indexOf(':');
  if (firstColon === -1) {
    // No second colon → no channelId
    return null;
  }

  const teamId = body.slice(0, firstColon);
  if (!teamId) {
    return null;
  }

  const rest = body.slice(firstColon + 1);
  if (!rest) {
    return null;
  }

  // Split rest into channelId and optional /threadTs
  const slashIdx = rest.indexOf('/');

  if (slashIdx === -1) {
    // Channel-level track (no threadTs)
    const channelId = rest;
    if (!channelId) {
      return null;
    }
    return { teamId, channelId };
  }

  // Threaded track
  const channelId = rest.slice(0, slashIdx);
  const threadTs = rest.slice(slashIdx + 1);

  if (!channelId || !threadTs) {
    // Empty channelId or empty threadTs after '/'
    return null;
  }

  return { teamId, channelId, threadTs };
}

/** Minimal shape of a `slack/send_message` tool input, for track derivation. */
export interface SlackSendInput {
  channel?: unknown;
  thread_ts?: unknown;
}

/**
 * Derive the Slack conversation track for an outbound send.
 *
 * Returns `null` when the track cannot be derived: no string `channel`,
 * no `teamId`, or parts that violate the track grammar. Callers decide what
 * `null` means — sen-core compaction maps it to its `'untracked'` sentinel;
 * the lace write seam leaves the event unstamped.
 *
 * This is the single shared derivation behind sen-core's compaction
 * attributor, the lace runner write-seam closure, and the lace recall indexer.
 */
export function deriveSendTrack(input: SlackSendInput, teamId: string | undefined): string | null {
  const channel = typeof input.channel === 'string' ? input.channel : null;
  if (!channel) return null;
  if (!teamId) return null;
  // An empty thread_ts is not a thread — treat as channel-level so the derived
  // track round-trips through parseSlackConvTrack (which rejects a trailing '/').
  const threadTs =
    typeof input.thread_ts === 'string' && input.thread_ts ? input.thread_ts : undefined;
  try {
    return formatSlackConvTrack(
      threadTs !== undefined
        ? { teamId, channelId: channel, threadTs }
        : { teamId, channelId: channel }
    );
  } catch {
    return null;
  }
}
