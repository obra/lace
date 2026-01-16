// ABOUTME: Tests for skill type definitions and validation

import { describe, it, expect } from 'vitest';
import { validateSkillName, validateSkillDescription, type SkillProperties } from '../types';

describe('validateSkillName', () => {
  it('accepts valid kebab-case names', () => {
    expect(validateSkillName('pdf-processing')).toEqual({ valid: true });
    expect(validateSkillName('commit')).toEqual({ valid: true });
    expect(validateSkillName('code-review')).toEqual({ valid: true });
  });

  it('accepts names with numbers', () => {
    expect(validateSkillName('v2-api')).toEqual({ valid: true });
    expect(validateSkillName('code2code')).toEqual({ valid: true });
  });

  it('rejects uppercase characters', () => {
    const result = validateSkillName('PDF-Processing');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase');
  });

  it('rejects names starting with hyphen', () => {
    const result = validateSkillName('-pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('start');
  });

  it('rejects names ending with hyphen', () => {
    const result = validateSkillName('pdf-');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('end');
  });

  it('rejects consecutive hyphens', () => {
    const result = validateSkillName('pdf--processing');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('consecutive');
  });

  it('rejects names over 64 characters', () => {
    const longName = 'a'.repeat(65);
    const result = validateSkillName(longName);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64');
  });

  it('rejects empty names', () => {
    const result = validateSkillName('');
    expect(result.valid).toBe(false);
  });

  it('rejects names with invalid characters', () => {
    const result = validateSkillName('pdf_processing');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase letters, numbers, and hyphens');
  });

  it('rejects names with spaces', () => {
    const result = validateSkillName('pdf processing');
    expect(result.valid).toBe(false);
  });
});

describe('validateSkillDescription', () => {
  it('accepts valid descriptions', () => {
    expect(validateSkillDescription('Extract text from PDFs')).toEqual({
      valid: true,
    });
  });

  it('accepts descriptions at exactly 1024 characters', () => {
    const desc = 'a'.repeat(1024);
    expect(validateSkillDescription(desc)).toEqual({ valid: true });
  });

  it('rejects empty descriptions', () => {
    const result = validateSkillDescription('');
    expect(result.valid).toBe(false);
  });

  it('rejects whitespace-only descriptions', () => {
    const result = validateSkillDescription('   ');
    expect(result.valid).toBe(false);
  });

  it('rejects descriptions over 1024 characters', () => {
    const longDesc = 'a'.repeat(1025);
    const result = validateSkillDescription(longDesc);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1024');
  });
});

describe('SkillProperties type', () => {
  it('accepts valid skill properties', () => {
    const props: SkillProperties = {
      name: 'pdf-processing',
      description: 'Extract text from PDFs',
    };
    expect(props.name).toBe('pdf-processing');
    expect(props.description).toBe('Extract text from PDFs');
  });

  it('accepts skill properties with optional fields', () => {
    const props: SkillProperties = {
      name: 'pdf-processing',
      description: 'Extract text from PDFs',
      license: 'MIT',
      compatibility: '>=1.0.0',
      metadata: { author: 'test', version: '1.0.0' },
    };
    expect(props.license).toBe('MIT');
    expect(props.compatibility).toBe('>=1.0.0');
    expect(props.metadata?.author).toBe('test');
  });
});
