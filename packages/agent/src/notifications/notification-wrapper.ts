// ABOUTME: Single source of truth for the <notification kind="..."> wrapper used by
// ABOUTME: every lace-side agent-facing notification (alarm-fired, job-*, subagent-exited).

export type NotificationKind =
  | 'alarm-fired'
  | 'alarm-expired'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled'
  | 'job-progress'
  | 'subagent-exited';

export interface BuildNotificationOptions {
  kind: NotificationKind;
  identifiers?: Record<string, string>;
  body: string;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildNotification(opts: BuildNotificationOptions): string {
  const attrs: string[] = [`kind="${escapeXmlAttr(opts.kind)}"`];
  if (opts.identifiers) {
    for (const [k, v] of Object.entries(opts.identifiers)) {
      if (v === '') continue;
      attrs.push(`${k}="${escapeXmlAttr(v)}"`);
    }
  }
  return `<notification ${attrs.join(' ')}>\n${opts.body}\n</notification>`;
}
