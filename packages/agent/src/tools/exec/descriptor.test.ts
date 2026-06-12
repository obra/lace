import { describe, it, expect } from 'vitest';
import { parseExecToolDescriptor, ExecToolDescriptorError } from './descriptor';
describe('parseExecToolDescriptor', () => {
  it('parses a valid descriptor', () => {
    const d = parseExecToolDescriptor(
      '{"name":"weather","description":"w","inputSchema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}'
    );
    expect(d.name).toBe('weather');
    expect(d.inputSchema.type).toBe('object');
  });
  it('accepts optional capabilities', () => {
    const d = parseExecToolDescriptor(
      '{"name":"c","description":"x","inputSchema":{"type":"object","properties":{}},"capabilities":["credentials"]}'
    );
    expect(d.capabilities).toEqual(['credentials']);
  });
  it('throws on bad JSON', () => {
    expect(() => parseExecToolDescriptor('nope')).toThrow(ExecToolDescriptorError);
  });
  it('throws on missing fields', () => {
    expect(() => parseExecToolDescriptor('{"name":"x"}')).toThrow(ExecToolDescriptorError);
  });
  for (const key of ['allOf', 'anyOf', 'oneOf', 'if'] as const) {
    it(`throws on top-level ${key} (Anthropic tool API rejects it)`, () => {
      const raw = `{"name":"c","description":"x","inputSchema":{"type":"object","properties":{"a":{"type":"string"}},"${key}":[{"required":["a"]}]}}`;
      expect(() => parseExecToolDescriptor(raw)).toThrow(ExecToolDescriptorError);
      expect(() => parseExecToolDescriptor(raw)).toThrow(key);
    });
  }
  it('allows combinators nested inside a property (only top-level is rejected)', () => {
    const d = parseExecToolDescriptor(
      '{"name":"c","description":"x","inputSchema":{"type":"object","properties":{"a":{"oneOf":[{"type":"string"},{"type":"number"}]}},"required":["a"]}}'
    );
    expect(d.name).toBe('c');
    expect(d.inputSchema.type).toBe('object');
  });
});
