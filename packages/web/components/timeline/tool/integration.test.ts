// ABOUTME: Integration tests for bash tool renderer registration
// ABOUTME: Verifies bash renderer is properly registered and accessible

import { describe, test, expect } from 'vitest';
import { getToolRenderer } from './index';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';

describe('Bash Tool Renderer Integration', () => {
  test('should retrieve bash renderer from registry', () => {
    const renderer = getToolRenderer('bash');

    expect(renderer).toBeDefined();
    expect(renderer.getSummary).toBeDefined();
    expect(renderer.isError).toBeDefined();
    expect(renderer.renderResult).toBeDefined();
    expect(renderer.getIcon).toBeDefined();
  });

  test('should handle bash_exec tool name', () => {
    const renderer = getToolRenderer('bash_exec');

    expect(renderer).toBeDefined();
    expect(renderer.getSummary).toBeDefined();
    expect(renderer.isError).toBeDefined();
    expect(renderer.renderResult).toBeDefined();
    expect(renderer.getIcon).toBeDefined();
  });

  test('should handle shell tool name', () => {
    const renderer = getToolRenderer('shell');

    expect(renderer).toBeDefined();
    expect(renderer.getSummary).toBeDefined();
    expect(renderer.isError).toBeDefined();
    expect(renderer.renderResult).toBeDefined();
    expect(renderer.getIcon).toBeDefined();
  });

  test('should handle case-insensitive lookup for bash', () => {
    const rendererLower = getToolRenderer('bash');
    const rendererUpper = getToolRenderer('BASH');
    const rendererMixed = getToolRenderer('Bash');

    expect(rendererLower).toBe(rendererUpper);
    expect(rendererLower).toBe(rendererMixed);
  });

  test('should return correct bash icon', () => {
    const renderer = getToolRenderer('bash');
    const icon = renderer.getIcon?.();

    expect(icon).toBe(faTerminal);
  });

  test('should create proper bash command summary', () => {
    const renderer = getToolRenderer('bash');
    const summary = renderer.getSummary?.({ command: 'ls -la' });

    expect(summary).toBe('$ ls -la');
  });
});
