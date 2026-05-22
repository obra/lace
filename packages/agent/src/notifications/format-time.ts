// ABOUTME: Centralized timestamp formatter for user-facing notification bodies
// ABOUTME: and tool output. Single source of truth: full ISO-8601 with explicit
// ABOUTME: offset, followed by the IANA zone name in parens. Example:
// ABOUTME:   formatAbsoluteTime(1798800000000, 'America/Los_Angeles')
// ABOUTME:     -> '2026-12-25T09:00:00-08:00 (America/Los_Angeles)'

/**
 * Format an instant in time for agent-facing output. Returns a string of the
 * form:
 *
 *   `<YYYY-MM-DDTHH:mm:ss±HH:mm> (<IANA-zone-name>)`
 *
 * The timezone name in parens is verbatim. Pass an IANA zone (e.g.
 * "America/Los_Angeles", "UTC", "Europe/London"). Throws on invalid IANA.
 */
export function formatAbsoluteTime(epochMs: number, timezone: string = 'UTC'): string {
  // Validate the zone — Intl.DateTimeFormat throws RangeError on invalid IANA.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }

  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(d);

  const lookup = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  let hour = lookup('hour');
  // Intl quirk: 'h23' style returns '24' for midnight in some locales.
  if (hour === '24') hour = '00';
  const minute = lookup('minute');
  const second = lookup('second');

  // 'longOffset' emits e.g. 'GMT-08:00' or 'GMT' for UTC. Normalize.
  const offsetRaw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  let offset: string;
  if (offsetRaw === 'GMT') {
    // UTC has no numeric offset suffix — treat as +00:00.
    offset = '+00:00';
  } else if (offsetRaw.startsWith('GMT')) {
    const suffix = offsetRaw.slice(3); // e.g. '-08:00' or '-8'
    // Normalize short form 'GMT-8' -> '-08:00'.
    const m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(suffix);
    if (m) {
      const sign = m[1];
      const hh = m[2].padStart(2, '0');
      const mm = (m[3] ?? '00').padStart(2, '0');
      offset = `${sign}${hh}:${mm}`;
    } else {
      offset = suffix;
    }
  } else {
    // Intl output shape is unrecognized — refuse to silently mislabel
    // a non-UTC zone as UTC. Surface the unhandled fields so the caller
    // can decide what to do.
    throw new Error(
      `Unsupported Intl timeZoneName output for timezone "${timezone}": ${JSON.stringify(offsetRaw)}`
    );
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset} (${timezone})`;
}
