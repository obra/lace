// ABOUTME: Tests for transcript-paths.ts — persona/date/session path resolver
// ABOUTME: Verifies UTC date semantics, null-persona handling, multi-file listing, and persona validation

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  transcriptDir,
  transcriptFilePath,
  transcriptsRoot,
  listTranscriptFiles,
  personaSegment,
  SECURE_FILE_MODE,
  SECURE_DIR_MODE,
} from '../transcript-paths';

describe('transcript-paths', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-transcript-paths-'));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe('personaSegment', () => {
    it('rejects literal "_unknown" (reserved as sentinel)', () => {
      expect(() => personaSegment('_unknown')).toThrow(/reserved/);
    });

    it('returns the sentinel _unknown when persona is null', () => {
      expect(personaSegment(null)).toBe('_unknown');
    });
  });

  describe('SECURE_FILE_MODE / SECURE_DIR_MODE', () => {
    it('exports SECURE_FILE_MODE = 0o600', () => {
      expect(SECURE_FILE_MODE).toBe(0o600);
    });

    it('exports SECURE_DIR_MODE = 0o700', () => {
      expect(SECURE_DIR_MODE).toBe(0o700);
    });
  });

  describe('transcriptsRoot', () => {
    it('returns <laceDir>/transcripts', () => {
      expect(transcriptsRoot('/tmp/lace')).toBe('/tmp/lace/transcripts');
    });
  });

  describe('transcriptDir', () => {
    it('joins root, persona, and UTC date', () => {
      const d = transcriptDir({
        laceDir: '/tmp/lace',
        persona: 'ada',
        date: new Date('2026-05-23T10:00:00Z'),
      });
      expect(d).toBe('/tmp/lace/transcripts/ada/2026-05-23');
    });

    it('uses _unknown bucket when persona is null', () => {
      const d = transcriptDir({
        laceDir: '/tmp/lace',
        persona: null,
        date: new Date('2026-05-23T10:00:00Z'),
      });
      expect(d).toBe('/tmp/lace/transcripts/_unknown/2026-05-23');
    });
  });

  describe('transcriptFilePath', () => {
    it('builds the canonical path for a persona+date+session', () => {
      const p = transcriptFilePath({
        laceDir: '/tmp/lace',
        persona: 'ada',
        date: new Date('2026-05-23T10:00:00Z'),
        sessionId: 'sess_abc',
      });
      expect(p).toBe('/tmp/lace/transcripts/ada/2026-05-23/sess_abc.jsonl');
    });

    it('uses UTC for date rollover, not local time', () => {
      // 23:59:59-08:00 is 07:59:59Z next day -> same UTC day if 23:59-08:00 is local
      // Actually 23:59:59-08:00 == 07:59:59Z (next UTC day if local date is PST 2026-05-23 23:59)
      // We pass 2026-05-23T23:59:59-08:00 which is 2026-05-24T07:59:59Z
      const p = transcriptFilePath({
        laceDir: '/tmp/lace',
        persona: 'ada',
        date: new Date('2026-05-23T23:59:59-08:00'),
        sessionId: 'sess_abc',
      });
      expect(p).toBe('/tmp/lace/transcripts/ada/2026-05-24/sess_abc.jsonl');
    });

    it('null persona writes under _unknown/<date>/', () => {
      const p = transcriptFilePath({
        laceDir: '/tmp/lace',
        persona: null,
        date: new Date('2026-05-23T10:00:00Z'),
        sessionId: 'sess_abc',
      });
      expect(p).toBe('/tmp/lace/transcripts/_unknown/2026-05-23/sess_abc.jsonl');
    });

    it('zero-pads month and day in date string', () => {
      const p = transcriptFilePath({
        laceDir: '/tmp/lace',
        persona: 'ada',
        date: new Date('2026-01-05T10:00:00Z'),
        sessionId: 'sess_abc',
      });
      expect(p).toBe('/tmp/lace/transcripts/ada/2026-01-05/sess_abc.jsonl');
    });

    it('rejects persona containing a path separator', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: 'ada/evil',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects persona containing a backslash', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: 'ada\\evil',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects persona equal to ".."', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: '..',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects empty-string persona (use null instead)', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: '',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects persona starting with a dash', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: '-rf',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects persona containing whitespace', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: 'ada bea',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects persona containing a tab character', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: 'ada\tbea',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });

    it('rejects persona containing a control character', () => {
      expect(() =>
        transcriptFilePath({
          laceDir: '/tmp/lace',
          persona: 'ada\x07evil',
          date: new Date('2026-05-23T10:00:00Z'),
          sessionId: 'sess_abc',
        })
      ).toThrow(/persona/);
    });
  });

  describe('listTranscriptFiles', () => {
    it('returns empty array when transcriptsRoot does not exist', () => {
      // tempDir exists but has no transcripts/ subdir
      expect(listTranscriptFiles(tempDir, 'sess_abc')).toEqual([]);
    });

    it('returns empty array when no files match the session id', () => {
      const dir = join(tempDir, 'transcripts', 'ada', '2026-05-23');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'sess_other.jsonl'), 'x');
      expect(listTranscriptFiles(tempDir, 'sess_abc')).toEqual([]);
    });

    it('lists all transcript files for a session across dates in ascending date order', () => {
      const personaDir = join(tempDir, 'transcripts', 'ada');
      const day1 = join(personaDir, '2026-05-23');
      const day2 = join(personaDir, '2026-05-24');
      const day3 = join(personaDir, '2026-05-25');
      mkdirSync(day1, { recursive: true });
      mkdirSync(day2, { recursive: true });
      mkdirSync(day3, { recursive: true });
      writeFileSync(join(day1, 'sess_abc.jsonl'), 'a');
      writeFileSync(join(day2, 'sess_abc.jsonl'), 'b');
      writeFileSync(join(day3, 'sess_abc.jsonl'), 'c');
      // A file for another session that should not appear
      writeFileSync(join(day2, 'sess_other.jsonl'), 'x');

      const files = listTranscriptFiles(tempDir, 'sess_abc');
      expect(files).toEqual([
        join(day1, 'sess_abc.jsonl'),
        join(day2, 'sess_abc.jsonl'),
        join(day3, 'sess_abc.jsonl'),
      ]);
    });

    it('lists files for a session that lived under multiple personas', () => {
      const adaDay = join(tempDir, 'transcripts', 'ada', '2026-05-23');
      const beaDay = join(tempDir, 'transcripts', 'bea', '2026-05-24');
      mkdirSync(adaDay, { recursive: true });
      mkdirSync(beaDay, { recursive: true });
      writeFileSync(join(adaDay, 'sess_abc.jsonl'), 'a');
      writeFileSync(join(beaDay, 'sess_abc.jsonl'), 'b');

      const files = listTranscriptFiles(tempDir, 'sess_abc');
      // Order across personas is not strictly specified, but both must be present.
      expect(files.sort()).toEqual(
        [join(adaDay, 'sess_abc.jsonl'), join(beaDay, 'sess_abc.jsonl')].sort()
      );
      expect(files).toHaveLength(2);
    });

    it('includes files from the _unknown bucket', () => {
      const day = join(tempDir, 'transcripts', '_unknown', '2026-05-23');
      mkdirSync(day, { recursive: true });
      writeFileSync(join(day, 'sess_abc.jsonl'), 'x');
      expect(listTranscriptFiles(tempDir, 'sess_abc')).toEqual([join(day, 'sess_abc.jsonl')]);
    });

    it('skips non-directory entries under transcripts/', () => {
      const root = join(tempDir, 'transcripts');
      mkdirSync(root, { recursive: true });
      // A stray file directly under transcripts/ must not break enumeration
      writeFileSync(join(root, 'stray.txt'), 'x');
      const day = join(root, 'ada', '2026-05-23');
      mkdirSync(day, { recursive: true });
      writeFileSync(join(day, 'sess_abc.jsonl'), 'x');
      expect(listTranscriptFiles(tempDir, 'sess_abc')).toEqual([join(day, 'sess_abc.jsonl')]);
    });
  });
});
