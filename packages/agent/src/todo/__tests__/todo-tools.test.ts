// ABOUTME: Tests for todo list tool execution logic

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { executeTodoRead, executeTodoWrite } from '../todo-tools';

describe('todo tools execution', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'todo-test-'));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  describe('executeTodoRead', () => {
    it('returns empty list when no todo file exists', async () => {
      const result = await executeTodoRead({}, { sessionDir });

      expect(result.status).toBe('completed');
      expect(JSON.parse(result.content[0].text)).toEqual({ items: [] });
    });

    it('returns items from existing todo file', async () => {
      const todoPath = join(sessionDir, 'todo.md');
      writeFileSync(
        todoPath,
        `- [ ] **First task** \`t_aaa\`
  Description one.

- [x] **Second task** \`t_bbb\`
`
      );

      const result = await executeTodoRead({}, { sessionDir });

      expect(result.status).toBe('completed');
      const data = JSON.parse(result.content[0].text);
      expect(data.items).toHaveLength(2);
      expect(data.items[0]).toEqual({
        id: 't_aaa',
        status: 'pending',
        title: 'First task',
        description: 'Description one.',
      });
      expect(data.items[1]).toEqual({
        id: 't_bbb',
        status: 'done',
        title: 'Second task',
      });
    });
  });

  describe('executeTodoWrite - create', () => {
    it('creates todo file and adds first item', async () => {
      const result = await executeTodoWrite(
        { title: 'New task', description: 'Task details' },
        { sessionDir }
      );

      expect(result.status).toBe('completed');
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toMatch(/^t_[a-z0-9]{3}$/);

      // Verify file contents
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('**New task**');
      expect(content).toContain('Task details');
      expect(content).toContain(`\`${data.id}\``);
    });

    it('appends to existing todo list', async () => {
      const todoPath = join(sessionDir, 'todo.md');
      writeFileSync(todoPath, `- [ ] **Existing task** \`t_old\`\n`);

      const result = await executeTodoWrite({ title: 'Second task' }, { sessionDir });

      expect(result.status).toBe('completed');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('**Existing task**');
      expect(content).toContain('**Second task**');
    });

    it('adds item without description', async () => {
      const result = await executeTodoWrite({ title: 'Quick task' }, { sessionDir });

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('**Quick task**');
    });

    it('creates item with custom status', async () => {
      const result = await executeTodoWrite(
        { title: 'Already done', status: 'done' },
        { sessionDir }
      );

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('- [x] **Already done**');
    });

    it('fails when title missing for new item', async () => {
      const result = await executeTodoWrite({ description: 'no title' }, { sessionDir });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('requires title');
    });
  });

  describe('executeTodoWrite - update', () => {
    beforeEach(() => {
      const todoPath = join(sessionDir, 'todo.md');
      writeFileSync(
        todoPath,
        `- [ ] **Task one** \`t_aaa\`
  Original description.

- [ ] **Task two** \`t_bbb\`
`
      );
    });

    it('marks item as done', async () => {
      const result = await executeTodoWrite({ id: 't_aaa', status: 'done' }, { sessionDir });

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('- [x] **Task one**');
    });

    it('marks item as pending', async () => {
      // First mark as done
      const todoPath = join(sessionDir, 'todo.md');
      writeFileSync(todoPath, `- [x] **Done task** \`t_ccc\`\n`);

      const result = await executeTodoWrite({ id: 't_ccc', status: 'pending' }, { sessionDir });

      expect(result.status).toBe('completed');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('- [ ] **Done task**');
    });

    it('updates title', async () => {
      const result = await executeTodoWrite(
        { id: 't_aaa', title: 'Updated title' },
        { sessionDir }
      );

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('**Updated title**');
      expect(content).not.toContain('**Task one**');
    });

    it('updates description', async () => {
      const result = await executeTodoWrite(
        { id: 't_aaa', description: 'New description' },
        { sessionDir }
      );

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('New description');
      expect(content).not.toContain('Original description');
    });

    it('updates multiple fields at once', async () => {
      const result = await executeTodoWrite(
        { id: 't_aaa', status: 'done', title: 'New title', description: 'New desc' },
        { sessionDir }
      );

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('- [x] **New title**');
      expect(content).toContain('New desc');
    });

    it('fails for non-existent id', async () => {
      const result = await executeTodoWrite({ id: 't_xxx', status: 'done' }, { sessionDir });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('not found');
    });

    it('preserves other items unchanged', async () => {
      await executeTodoWrite({ id: 't_aaa', status: 'done' }, { sessionDir });

      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toContain('**Task two**');
      expect(content).toContain('`t_bbb`');
    });
  });

  describe('executeTodoWrite - remove', () => {
    beforeEach(() => {
      const todoPath = join(sessionDir, 'todo.md');
      writeFileSync(
        todoPath,
        `- [ ] **Task one** \`t_aaa\`

- [ ] **Task two** \`t_bbb\`

- [ ] **Task three** \`t_ccc\`
`
      );
    });

    it('removes item by setting status to removed', async () => {
      const result = await executeTodoWrite({ id: 't_bbb', status: 'removed' }, { sessionDir });

      expect(result.status).toBe('completed');
      const todoPath = join(sessionDir, 'todo.md');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).not.toContain('Task two');
      expect(content).toContain('Task one');
      expect(content).toContain('Task three');
    });

    it('fails for non-existent id when removing', async () => {
      const result = await executeTodoWrite({ id: 't_xxx', status: 'removed' }, { sessionDir });

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('not found');
    });

    it('removes last item leaving empty file', async () => {
      const todoPath = join(sessionDir, 'todo.md');
      writeFileSync(todoPath, `- [ ] **Only task** \`t_only\`\n`);

      const result = await executeTodoWrite({ id: 't_only', status: 'removed' }, { sessionDir });

      expect(result.status).toBe('completed');
      const content = readFileSync(todoPath, 'utf-8');
      expect(content).toBe('');
    });
  });
});
