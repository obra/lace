// ABOUTME: Tests for redact.ts — best-effort secret redaction for recall egress
// ABOUTME: One match + one non-match per pattern, plus pass-through/multi/empty cases

import { describe, expect, it } from 'vitest';
import { redact } from '../redact';

describe('redact', () => {
  describe('pass-through', () => {
    it('returns empty string unchanged', () => {
      expect(redact('')).toBe('');
    });

    it('returns plain text unchanged', () => {
      const input = 'Hello world, no secrets here. Just normal prose.';
      expect(redact(input)).toBe(input);
    });

    it('does not redact short non-secret-looking tokens', () => {
      const input = 'sk-too-short and ops_short and AKIA123';
      expect(redact(input)).toBe(input);
    });
  });

  describe('slack tokens', () => {
    it('redacts xoxb tokens', () => {
      const input = 'token=xoxb-1234567890-abcdefghijklmnop';
      expect(redact(input)).toBe('token=<REDACTED:slack>');
    });

    it('redacts xoxp tokens', () => {
      const input = 'xoxp-1111111111-2222222222-abcdefghij';
      expect(redact(input)).toBe('<REDACTED:slack>');
    });

    it('redacts xoxa tokens', () => {
      const input = 'xoxa-12345678901234567890-extra';
      expect(redact(input)).toBe('<REDACTED:slack>');
    });

    it('does not redact non-matching xox prefix', () => {
      const input = 'xoxz-1234567890-abcdefghijklmnop';
      expect(redact(input)).toBe(input);
    });

    it('does not redact too-short slack-like string', () => {
      const input = 'xoxb-short';
      expect(redact(input)).toBe(input);
    });
  });

  describe('anthropic / openai keys', () => {
    it('redacts sk-ant- keys', () => {
      const input = 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';
      expect(redact(input)).toBe('ANTHROPIC_API_KEY=<REDACTED:anthropic-or-openai>');
    });

    it('redacts sk-proj- keys', () => {
      const input = 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
      expect(redact(input)).toBe('OPENAI_API_KEY=<REDACTED:anthropic-or-openai>');
    });

    it('does not redact plain sk- prefix', () => {
      const input = 'sk-other-abcdefghijklmnopqrstuvwxyz1234567890';
      expect(redact(input)).toBe(input);
    });

    it('does not redact too-short sk-ant key', () => {
      const input = 'sk-ant-short';
      expect(redact(input)).toBe(input);
    });
  });

  describe('aws access keys', () => {
    it('redacts AKIA keys', () => {
      const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      expect(redact(input)).toBe('AWS_ACCESS_KEY_ID=<REDACTED:aws-access-key>');
    });

    it('does not redact non-AKIA prefix', () => {
      const input = 'BKIAIOSFODNN7EXAMPLE';
      expect(redact(input)).toBe(input);
    });

    it('does not redact AKIA with lowercase letters in body', () => {
      const input = 'AKIAabcdefghij1234567';
      expect(redact(input)).toBe(input);
    });
  });

  describe('github tokens', () => {
    it('redacts ghp_ tokens', () => {
      const input = 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      expect(redact(input)).toBe('GITHUB_TOKEN=<REDACTED:github>');
    });

    it('redacts gho_ tokens', () => {
      const input = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
      expect(redact(input)).toBe('<REDACTED:github>');
    });

    it('redacts ghu_, ghs_, ghr_ tokens', () => {
      const u = 'ghu_abcdefghijklmnopqrstuvwxyz0123456789';
      const s = 'ghs_abcdefghijklmnopqrstuvwxyz0123456789';
      const r = 'ghr_abcdefghijklmnopqrstuvwxyz0123456789';
      expect(redact(u)).toBe('<REDACTED:github>');
      expect(redact(s)).toBe('<REDACTED:github>');
      expect(redact(r)).toBe('<REDACTED:github>');
    });

    it('does not redact ghx_ (not in charset)', () => {
      const input = 'ghx_abcdefghijklmnopqrstuvwxyz0123456789';
      expect(redact(input)).toBe(input);
    });

    it('does not redact too-short github token', () => {
      const input = 'ghp_short';
      expect(redact(input)).toBe(input);
    });

    it('redacts full GitHub token of length 40 (no trailing leak)', () => {
      const token = 'ghp_' + 'A'.repeat(40);
      expect(redact(`auth: ${token}`)).toBe('auth: <REDACTED:github>');
    });

    it('redacts at non-alphanum boundary', () => {
      const token = 'ghp_' + 'B'.repeat(40);
      expect(redact(`(${token}) here`)).toBe('(<REDACTED:github>) here');
    });

    it('still redacts a 36-char token (minimum length)', () => {
      const token = 'ghp_' + 'C'.repeat(36);
      expect(redact(`x ${token} y`)).toBe('x <REDACTED:github> y');
    });
  });

  describe('1password tokens', () => {
    it('redacts ops_ tokens', () => {
      const input = 'OP_SERVICE_ACCOUNT_TOKEN=ops_abcdefghijklmnopqrstuvwxyz==';
      expect(redact(input)).toBe('OP_SERVICE_ACCOUNT_TOKEN=<REDACTED:1password>');
    });

    it('does not redact ops_ followed by too few chars', () => {
      const input = 'ops_short';
      expect(redact(input)).toBe(input);
    });
  });

  describe('google api keys', () => {
    it('redacts AIza keys', () => {
      const input = 'GOOGLE_API_KEY=AIzaSyA-abcdefghijklmnopqrstuvwxyz01234';
      expect(redact(input)).toBe('GOOGLE_API_KEY=<REDACTED:google>');
    });

    it('does not redact AIza with too few chars', () => {
      const input = 'AIzaShort';
      expect(redact(input)).toBe(input);
    });
  });

  describe('combined', () => {
    it('redacts multiple distinct secrets in one string', () => {
      const input =
        'export SLACK=xoxb-1234567890-abcdefghijklmnop\n' +
        'export ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890\n' +
        'export AWS=AKIAIOSFODNN7EXAMPLE\n';
      const expected =
        'export SLACK=<REDACTED:slack>\n' +
        'export ANTHROPIC=<REDACTED:anthropic-or-openai>\n' +
        'export AWS=<REDACTED:aws-access-key>\n';
      expect(redact(input)).toBe(expected);
    });

    it('redacts multiple occurrences of the same pattern', () => {
      const input = 'one=AKIAIOSFODNN7EXAMPLE two=AKIAIOSFODNN7EXAMPLA';
      expect(redact(input)).toBe('one=<REDACTED:aws-access-key> two=<REDACTED:aws-access-key>');
    });
  });
});
