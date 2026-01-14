// ABOUTME: Tests for todo list markdown parsing and serialization

import { describe, it, expect } from 'vitest';
import { parseTodoMarkdown, serializeTodoMarkdown } from '../markdown';
import type { TodoItem } from '../types';

describe('parseTodoMarkdown', () => {
  it('parses empty content as empty list', () => {
    expect(parseTodoMarkdown('')).toEqual([]);
    expect(parseTodoMarkdown('   \n\n  ')).toEqual([]);
  });

  it('parses a single incomplete item', () => {
    const md = `- [ ] **Write tests** \`t_abc\`
  Need to write comprehensive tests.`;

    const items = parseTodoMarkdown(md);
    expect(items).toEqual([
      {
        id: 't_abc',
        done: false,
        title: 'Write tests',
        description: 'Need to write comprehensive tests.',
      },
    ]);
  });

  it('parses a single completed item', () => {
    const md = `- [x] **Deploy to prod** \`t_xyz\`
  Deployed successfully.`;

    const items = parseTodoMarkdown(md);
    expect(items).toEqual([
      {
        id: 't_xyz',
        done: true,
        title: 'Deploy to prod',
        description: 'Deployed successfully.',
      },
    ]);
  });

  it('parses item without description', () => {
    const md = `- [ ] **Quick task** \`t_123\``;

    const items = parseTodoMarkdown(md);
    expect(items).toEqual([
      {
        id: 't_123',
        done: false,
        title: 'Quick task',
        description: undefined,
      },
    ]);
  });

  it('parses multiple items', () => {
    const md = `- [ ] **First task** \`t_aaa\`
  Do the first thing.

- [x] **Second task** \`t_bbb\`
  Already done.

- [ ] **Third task** \`t_ccc\``;

    const items = parseTodoMarkdown(md);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      id: 't_aaa',
      done: false,
      title: 'First task',
      description: 'Do the first thing.',
    });
    expect(items[1]).toEqual({
      id: 't_bbb',
      done: true,
      title: 'Second task',
      description: 'Already done.',
    });
    expect(items[2]).toEqual({
      id: 't_ccc',
      done: false,
      title: 'Third task',
      description: undefined,
    });
  });

  it('handles multi-line descriptions', () => {
    const md = `- [ ] **Complex task** \`t_mul\`
  This is a longer description
  that spans multiple lines
  with detailed instructions.`;

    const items = parseTodoMarkdown(md);
    expect(items[0].description).toBe(
      'This is a longer description\nthat spans multiple lines\nwith detailed instructions.'
    );
  });

  it('handles [X] uppercase checkbox', () => {
    const md = `- [X] **Done item** \`t_upp\``;

    const items = parseTodoMarkdown(md);
    expect(items[0].done).toBe(true);
  });
});

describe('serializeTodoMarkdown', () => {
  it('serializes empty list', () => {
    expect(serializeTodoMarkdown([])).toBe('');
  });

  it('serializes single incomplete item', () => {
    const items: TodoItem[] = [
      {
        id: 't_abc',
        done: false,
        title: 'Write tests',
        description: 'Need to write comprehensive tests.',
      },
    ];

    const md = serializeTodoMarkdown(items);
    expect(md).toBe(`- [ ] **Write tests** \`t_abc\`
  Need to write comprehensive tests.
`);
  });

  it('serializes single completed item', () => {
    const items: TodoItem[] = [
      {
        id: 't_xyz',
        done: true,
        title: 'Deploy to prod',
        description: 'Deployed successfully.',
      },
    ];

    const md = serializeTodoMarkdown(items);
    expect(md).toBe(`- [x] **Deploy to prod** \`t_xyz\`
  Deployed successfully.
`);
  });

  it('serializes item without description', () => {
    const items: TodoItem[] = [
      {
        id: 't_123',
        done: false,
        title: 'Quick task',
      },
    ];

    const md = serializeTodoMarkdown(items);
    expect(md).toBe(`- [ ] **Quick task** \`t_123\`
`);
  });

  it('serializes multiple items with blank lines between', () => {
    const items: TodoItem[] = [
      { id: 't_aaa', done: false, title: 'First', description: 'Do first.' },
      { id: 't_bbb', done: true, title: 'Second' },
    ];

    const md = serializeTodoMarkdown(items);
    expect(md).toBe(`- [ ] **First** \`t_aaa\`
  Do first.

- [x] **Second** \`t_bbb\`
`);
  });

  it('handles multi-line descriptions with proper indentation', () => {
    const items: TodoItem[] = [
      {
        id: 't_mul',
        done: false,
        title: 'Complex task',
        description: 'Line one\nLine two\nLine three',
      },
    ];

    const md = serializeTodoMarkdown(items);
    expect(md).toBe(`- [ ] **Complex task** \`t_mul\`
  Line one
  Line two
  Line three
`);
  });

  it('round-trips correctly', () => {
    const original: TodoItem[] = [
      { id: 't_aaa', done: false, title: 'First task', description: 'Details here.' },
      { id: 't_bbb', done: true, title: 'Second task', description: 'Multi\nline\ndesc' },
      { id: 't_ccc', done: false, title: 'Third task' },
    ];

    const md = serializeTodoMarkdown(original);
    const parsed = parseTodoMarkdown(md);

    expect(parsed).toEqual(original);
  });
});
