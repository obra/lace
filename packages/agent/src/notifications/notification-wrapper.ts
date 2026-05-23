// packages/agent/src/notifications/notification-wrapper.ts
// ABOUTME: Single source of truth for the <notification kind="..."> wrapper.
// ABOUTME: Body is XML-escaped at injection (& then <); attributes accept numbers via String(v).

export type NotificationKind =
  | 'reminder'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled'
  | 'job-progress'
  | 'subagent-exited';

export interface BuildNotificationOptions {
  kind: NotificationKind;
  /** Identifier attributes; legacy callers (job-*) keep using this. */
  identifiers?: Record<string, string>;
  /** Typed attributes; values may be string or number. undefined/null entries are omitted. */
  attributes?: Record<string, string | number | null | undefined>;
  /** Body content; will be XML-escaped (& then <). */
  body: string;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXmlText(value: string): string {
  // Standard text-content escape: & first so &lt; doesn't double-escape into &amp;lt;.
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function attrValueToString(v: string | number | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`non-finite attribute value: ${v}`);
    }
    return String(v);
  }
  return v;
}

export function buildNotification(opts: BuildNotificationOptions): string {
  const parts: string[] = [`kind="${escapeXmlAttr(opts.kind)}"`];
  if (opts.identifiers) {
    for (const [k, v] of Object.entries(opts.identifiers)) {
      if (v === '') continue; // existing convention
      parts.push(`${k}="${escapeXmlAttr(v)}"`);
    }
  }
  if (opts.attributes) {
    for (const [k, v] of Object.entries(opts.attributes)) {
      const s = attrValueToString(v);
      if (s === null) continue;
      parts.push(`${k}="${escapeXmlAttr(s)}"`);
    }
  }
  return `<notification ${parts.join(' ')}>\n${escapeXmlText(opts.body)}\n</notification>`;
}
