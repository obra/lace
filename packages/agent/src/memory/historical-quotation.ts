// ABOUTME: Present validated original spans as historical quotations with source-specific attribution.
import type { HistoricalQuotation, OriginalEvidence, SuppliedSource } from './types';

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => entities[entity]);
}
export function escapeHistorical(text: string, attribute = false): string {
  return text.replace(
    attribute ? /[&<>"']/g : /[&<>]/g,
    (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!
  );
}
function attributes(text: string): Record<string, string> {
  return Object.fromEntries(
    [...text.matchAll(/([\w]+)=(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
      match[1],
      decode(match[2] ?? match[3]),
    ])
  );
}
function timeMetadata(values: Record<string, string>, prefix: string): Record<string, string> {
  const entries = Object.entries(values);
  if (!entries.length) return { [`${prefix}_status`]: 'unavailable' };
  if (entries.some(([, value]) => !Number.isFinite(Date.parse(value))))
    return { ...values, [`${prefix}_status`]: 'invalid' };
  if (entries.some(([, value]) => Date.parse(value) !== Date.parse(entries[0][1])))
    return { ...values, [`${prefix}_status`]: 'conflicting' };
  return { [prefix]: entries[0][1], [`${prefix}_source`]: entries[0][0] };
}

type QuotationRegion = {
  start: number;
  end: number;
  metadata: Record<string, string>;
};
type QuotationBody = Omit<HistoricalQuotation, 'excerpts'> & { regions: QuotationRegion[] };

function quotationBody(
  source: Pick<SuppliedSource, 'reference' | 'recordedAt'>,
  text: string,
  original: OriginalEvidence
): QuotationBody {
  const ref = source.reference;
  const metadata: Record<string, string> = source.recordedAt
    ? { recorded_at: source.recordedAt }
    : {};
  const read: HistoricalQuotation['read'] =
    ref.kind === 'event'
      ? { action: 'read', event_id: `${ref.sessionId}:${ref.eventSeq}`, context: 5, full: true }
      : { action: 'read', event_id: original.handle };
  if (ref.kind === 'document') {
    metadata.path = ref.path;
    if (ref.path.startsWith('user/journal/') || ref.path.startsWith('journal/')) {
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const fields = Object.fromEntries(
        [...(header?.[1] ?? '').matchAll(/^(title|date|timestamp):\s*(.*)$/gm)].map((match) => [
          match[1],
          match[2].trim(),
        ])
      );
      if (fields.title) {
        try {
          const title: unknown = JSON.parse(fields.title);
          metadata.title = typeof title === 'string' ? title : fields.title;
        } catch {
          metadata.title = fields.title;
        }
      }
      const times: Record<string, string> = {};
      if (fields.date) times.date = fields.date;
      if (fields.timestamp) {
        const epoch = new Date(Number(fields.timestamp));
        times.timestamp = Number.isFinite(epoch.getTime()) ? epoch.toISOString() : fields.timestamp;
      }
      Object.assign(metadata, timeMetadata(times, 'entry_time'));
      return {
        kind: 'journal',
        metadata,
        regions: [{ start: header?.[0].length ?? 0, end: text.length, metadata: {} }],
        read,
      };
    }
  } else {
    const groups = [...text.matchAll(/<messages\b([^>]*)>([\s\S]*?)<\/messages>/g)];
    const remainder = text
      .replace(/<messages\b[^>]*>[\s\S]*?<\/messages>/g, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
    const messagePattern = /<message\b([^>]*)>([\s\S]*?)<\/message>/g;
    // Only Sen's finite envelope is recognized; arbitrary historical text stays quoted source text.
    if (
      groups.length &&
      !remainder.trim() &&
      groups.every(
        (group) =>
          !group[2]
            .replace(messagePattern, '')
            .replace(/<\/?(?:current|catch_up)\b[^>]*>/g, '')
            .trim()
      )
    ) {
      const regions: QuotationRegion[] = [];
      for (const group of groups) {
        const groupMetadata = attributes(group[1]);
        const bodyStart = group.index + group[0].indexOf('>') + 1;
        for (const message of group[2].matchAll(messagePattern)) {
          const start = bodyStart + message.index + message[0].indexOf('>') + 1;
          const attrs = attributes(message[1]);
          const attribution: Record<string, string> = {};
          for (const key of ['source', 'conversation', 'channel', 'room'])
            if (groupMetadata[key]) attribution[key] = groupMetadata[key];
          if (attrs.from) attribution.sender = attrs.from;
          if (attrs.ref) attribution.message_ref = attrs.ref;
          const times: Record<string, string> = {};
          for (const key of ['sent_at', 'at']) if (attrs[key]) times[key] = attrs[key];
          Object.assign(attribution, timeMetadata(times, 'message_time'));
          regions.push({ start, end: start + message[2].length, metadata: attribution });
        }
      }
      return { kind: 'message', metadata, regions, read };
    }
  }
  return {
    kind: 'source',
    metadata,
    regions: [{ start: 0, end: text.length, metadata: {} }],
    read,
  };
}

function quote(body: QuotationBody, text: string, original: OriginalEvidence): HistoricalQuotation {
  const { regions, ...quotation } = body;
  return {
    ...quotation,
    excerpts: regions.flatMap((region) => {
      const start = Math.max(original.start, region.start);
      const end = Math.min(original.end, region.end);
      if (start >= end) return [];
      const excerpt = text.slice(start, end);
      return [
        { metadata: region.metadata, text: body.kind === 'message' ? decode(excerpt) : excerpt },
      ];
    }),
  };
}

export function historicalQuotation(
  source: Pick<SuppliedSource, 'reference' | 'recordedAt'>,
  text: string,
  original: OriginalEvidence
): HistoricalQuotation {
  return quote(quotationBody(source, text, original), text, original);
}

// Complete only sentences intersected by the validated retrieval span, within recognized bodies.
export function completeHistoricalEvidence(
  source: Pick<SuppliedSource, 'reference' | 'recordedAt'>,
  text: string,
  original: OriginalEvidence
): OriginalEvidence {
  const body = quotationBody(source, text, original);
  const spans = body.regions.flatMap((region) => {
    const start = Math.max(original.start, region.start);
    const end = Math.min(original.end, region.end);
    if (start >= end) return [];
    return [...sentences.segment(text.slice(region.start, region.end))]
      .map((sentence) => ({
        start: region.start + sentence.index,
        end: region.start + sentence.index + sentence.segment.length,
      }))
      .filter((sentence) => sentence.start < end && sentence.end > start);
  });
  const completed = spans.length
    ? {
        ...original,
        start: spans[0].start,
        end: spans[spans.length - 1].end,
        text: text.slice(spans[0].start, spans[spans.length - 1].end),
      }
    : original;
  return { ...completed, quotation: quote(body, text, completed) };
}
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

export function renderHistoricalQuotation(original: OriginalEvidence): string {
  const quotation = original.quotation ?? {
    kind: 'source',
    metadata: {},
    excerpts: [{ metadata: {}, text: original.text }],
    read:
      original.source.kind === 'event'
        ? {
            action: 'read',
            event_id: `${original.source.sessionId}:${original.source.eventSeq}`,
            context: 5,
            full: true,
          }
        : { action: 'read', event_id: original.handle },
  };
  const attrs = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([key, value]) => ` ${key}="${escapeHistorical(value, true)}"`)
      .join('');
  return `<historical-${quotation.kind} handle="${escapeHistorical(original.handle, true)}"${attrs(quotation.metadata)}>\n${quotation.excerpts
    .map((excerpt) => `<quote${attrs(excerpt.metadata)}>${escapeHistorical(excerpt.text)}</quote>`)
    .join(
      '\n'
    )}\n${quotation.read.context === undefined ? 'Whole retained source' : 'Retained surrounding context (bounded event window)'}: recall(${JSON.stringify(quotation.read)})\n</historical-${quotation.kind}>`;
}
