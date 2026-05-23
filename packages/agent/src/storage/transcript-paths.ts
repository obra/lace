// ABOUTME: Resolve transcript file paths under <persona>/<date>/<session>.jsonl layout
// ABOUTME: All dates are UTC; cross-midnight produces files in adjacent day directories

import * as fs from 'node:fs';
import * as path from 'node:path';

export type TranscriptPathInput = {
  laceDir: string;
  persona: string | null;
  date: Date;
  sessionId: string;
};

/** Sentinel persona bucket used when SessionMeta.persona is unset. */
export const UNKNOWN_PERSONA_BUCKET = '_unknown';

export function transcriptsRoot(laceDir: string): string {
  return path.join(laceDir, 'transcripts');
}

function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the persona to a safe directory segment, validating that it cannot
 * escape the persona bucket. Null becomes the `_unknown` sentinel. Empty
 * strings, names with path separators, and `.`/`..` are rejected — the caller
 * must pass `null` when persona is unknown.
 */
function personaSegment(persona: string | null): string {
  if (persona === null) return UNKNOWN_PERSONA_BUCKET;
  if (persona.length === 0) {
    throw new Error('persona must be a non-empty string or null');
  }
  if (persona.includes('/') || persona.includes('\\')) {
    throw new Error(`persona must not contain path separators: ${JSON.stringify(persona)}`);
  }
  if (persona === '.' || persona === '..') {
    throw new Error(`persona must not be a relative-path segment: ${JSON.stringify(persona)}`);
  }
  if (persona.includes('\0')) {
    throw new Error('persona must not contain NUL bytes');
  }
  return persona;
}

export function transcriptDir(input: Omit<TranscriptPathInput, 'sessionId'>): string {
  return path.join(
    transcriptsRoot(input.laceDir),
    personaSegment(input.persona),
    utcDateString(input.date)
  );
}

export function transcriptFilePath(input: TranscriptPathInput): string {
  return path.join(transcriptDir(input), `${input.sessionId}.jsonl`);
}

/**
 * All transcript files for a session_id across personas and dates.
 *
 * Returns paths in ascending date order within each persona; ordering across
 * personas is filesystem-dependent (callers needing a strict global order should
 * re-sort). For v0.1 this performs O(personas * days) directory scans; if the
 * transcripts tree grows large we should add an index.
 */
export function listTranscriptFiles(laceDir: string, sessionId: string): string[] {
  const root = transcriptsRoot(laceDir);
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const persona of fs.readdirSync(root)) {
    const personaDir = path.join(root, persona);
    if (!fs.statSync(personaDir).isDirectory()) continue;
    for (const date of fs.readdirSync(personaDir).sort()) {
      const dateDir = path.join(personaDir, date);
      if (!fs.statSync(dateDir).isDirectory()) continue;
      const candidate = path.join(dateDir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) result.push(candidate);
    }
  }
  return result;
}
