// ABOUTME: Related current heads use disposable revision vectors, with visible literal text fallback.
import type { MemoryNotes } from './notes';
import type { Note } from './types';
import type { MemoryEncoder } from './encoder';
import { MEMORY_LIMITS as L } from './types';

export async function relatedNotes(
  notes: MemoryNotes,
  encoder: MemoryEncoder,
  text: string,
  check: () => void
): Promise<{ notes: Note[]; reason?: string }> {
  const heads = notes.candidates();
  if (!heads.length) return { notes: [] };
  try {
    const [query] = await encoder.encode([text], 'query');
    check();
    const vectors = new Map<string, number[]>();
    const missing = heads.filter((note) => {
      const vector = notes.vector(note, encoder.generation);
      if (vector) vectors.set(note.id, vector);
      return !vector;
    });
    for (let offset = 0; offset < missing.length; offset += 4) {
      const batch = missing.slice(offset, offset + 4);
      const encoded = await encoder.encode(
        batch.map((note) => note.text),
        'document'
      );
      check();
      for (const [index, note] of batch.entries()) {
        notes.cacheVector(note, encoder.generation, encoded[index]);
        vectors.set(note.id, encoded[index]);
      }
    }
    check();
    if (heads.some((note) => notes.note(note.id)?.revision !== note.revision))
      throw new Error('Candidate revision changed');
    return {
      notes: heads
        .map((note, index) => ({
          note,
          index,
          score: vectors.get(note.id)!.reduce((sum, value, i) => sum + value * query[i], 0),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, L.candidates)
        .map((row) => row.note),
    };
  } catch (error) {
    // Authority or lifetime loss must not be disguised as an encoder failure.
    check();
    const terms = [...new Set(text.match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 64);
    const query = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    const rows = query
      ? (notes.db
          .prepare('SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?')
          .all(query, L.candidates) as { id: string }[])
      : [];
    return {
      notes: rows.map(({ id }) => notes.note(id)!).filter(Boolean),
      reason: `Related retrieval text-only: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
