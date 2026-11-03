// ABOUTME: Finite-format quotation regressions for retained journal metadata and safe readable markup.
import { expect, it } from 'vitest';
import { historicalQuotation, renderHistoricalQuotation } from '../historical-quotation';
import type { OriginalEvidence, SuppliedSource } from '../types';

function journal(text: string, path = 'user/journal/entry.md') {
  const source: Pick<SuppliedSource, 'reference'> = {
    reference: { kind: 'document', gitRoot: '/fixture', path, commit: 'commit', blob: 'blob' },
  };
  const original: OriginalEvidence = {
    handle: 'source:immutable',
    source: { kind: 'document', id: 'entry', version: 'blob' },
    start: 0,
    end: text.length,
    text,
  };
  return { ...original, quotation: historicalQuotation(source, text, original) };
}

it('recognizes a journal at the configured repository-root journal path', () => {
  const original = journal(
    '---\ndate: 2026-03-04T16:00:00.000Z\n---\nRetained decision.',
    'journal/entry.md'
  );
  expect(original.quotation).toMatchObject({
    kind: 'journal',
    metadata: { path: 'journal/entry.md', entry_time: '2026-03-04T16:00:00.000Z' },
    excerpts: [{ metadata: {}, text: 'Retained decision.' }],
  });
});

it.each(['null', '123', '{"misplaced":"object"}'])(
  'keeps non-string journal title %s as source text without breaking recall',
  (title) => {
    const original = journal(`---\ntitle: ${title}\n---\nRetained decision.`);
    expect(original.quotation.metadata.title).toBe(title);
    expect(() => renderHistoricalQuotation(original)).not.toThrow();
  }
);

it('leaves ordinary quotation marks readable while escaping attribute and body markup', () => {
  const original = journal(
    '---\ntitle: "A \\"quoted\\" & <title>"\n---\nUse "violet" & <current> as literal words.'
  );
  const rendered = renderHistoricalQuotation(original);
  expect(rendered).toContain('Use "violet" &amp; &lt;current&gt; as literal words.');
  expect(rendered).toContain('title="A &quot;quoted&quot; &amp; &lt;title&gt;"');
});
