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
});
