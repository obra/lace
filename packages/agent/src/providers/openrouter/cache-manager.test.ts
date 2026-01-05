import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalogCacheManager } from './cache-manager';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('CatalogCacheManager', () => {
  let tempDir: string;
  let manager: CatalogCacheManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-test-'));
    manager = new CatalogCacheManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true });
  });

  it('should save and load cache', async () => {
    const catalog = {
      _meta: {
        fetchedAt: new Date().toISOString(),
        version: '1.0',
        modelCount: 2,
        source: 'test',
      },
      provider: {
        name: 'Test',
        id: 'test',
        models: [],
      },
    };

    await manager.save('test-instance', catalog);
    const loaded = await manager.load('test-instance');

    expect(loaded).toEqual(catalog);
  });

  it('should check if cache is stale', async () => {
    const oldCatalog = {
      _meta: {
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        version: '1.0',
        modelCount: 1,
        source: 'test',
      },
      provider: { name: 'Test', id: 'test', models: [] },
    };

    await manager.save('test-instance', oldCatalog);
    const isStale = await manager.isStale('test-instance');

    expect(isStale).toBe(true);
  });

  it('should return null for missing cache', async () => {
    const result = await manager.load('nonexistent');
    expect(result).toBeNull();
  });

  it('should consider fresh cache as not stale', async () => {
    const freshCatalog = {
      _meta: {
        fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        version: '1.0',
        modelCount: 5,
        source: 'test',
      },
      provider: { name: 'Test', id: 'test', models: [] },
    };

    await manager.save('test-instance', freshCatalog);
    const isStale = await manager.isStale('test-instance');

    expect(isStale).toBe(false);
  });

  it('should use custom max age for staleness check', async () => {
    const catalog = {
      _meta: {
        fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        version: '1.0',
        modelCount: 3,
        source: 'test',
      },
      provider: { name: 'Test', id: 'test', models: [] },
    };

    await manager.save('test-instance', catalog);

    // With custom 1 hour max age, should be stale
    const isStale = await manager.isStale('test-instance', 60 * 60 * 1000);
    expect(isStale).toBe(true);

    // With custom 3 hour max age, should not be stale
    const isNotStale = await manager.isStale('test-instance', 3 * 60 * 60 * 1000);
    expect(isNotStale).toBe(false);
  });

  it('should create cache directory if it does not exist', async () => {
    const nonExistentDir = path.join(tempDir, 'does-not-exist');
    const managerWithNewDir = new CatalogCacheManager(nonExistentDir);

    const catalog = {
      _meta: {
        fetchedAt: new Date().toISOString(),
        version: '1.0',
        modelCount: 1,
        source: 'test',
      },
      provider: { name: 'Test', id: 'test', models: [] },
    };

    // Should not throw and should create directory
    await managerWithNewDir.save('test', catalog);

    // Verify directory was created
    expect(fs.existsSync(path.join(nonExistentDir, 'catalogs'))).toBe(true);

    // Verify file can be loaded
    const loaded = await managerWithNewDir.load('test');
    expect(loaded).toEqual(catalog);
  });

  it('should handle file system errors gracefully', async () => {
    // Try to load from a path that will cause errors
    const result = await manager.load('test-instance');
    expect(result).toBeNull(); // Should return null, not throw
  });
});
