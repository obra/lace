import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ProviderCatalogManager } from '../manager';
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const setLaceDir = (dir: string) => {
  process.env.LACE_DIR = dir;
};

describe('ProviderCatalogManager model gating', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'lace-gating-'));
    setLaceDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and applies model gating per provider', async () => {
    const providerId = 'openai';

    const mgr = new ProviderCatalogManager();
    await mgr.loadCatalogs();
    const provider = mgr.getProvider(providerId);
    expect(provider).not.toBeNull();
    const modelIds = provider!.models.slice(0, 3).map((m) => m.id);
    const [keep1, keep2, drop] = modelIds;

    await mgr.setModelGating(providerId, { enabled: [keep1, keep2], disabled: [drop] });
    const gated = mgr.applyModelGating(providerId, provider!.models);
    const gatedIds = gated.map((m) => m.id);
    expect(gatedIds).toContain(keep1);
    expect(gatedIds).toContain(keep2);
    expect(gatedIds).not.toContain(drop);

    // Reload manager to ensure persistence
    const mgr2 = new ProviderCatalogManager();
    await mgr2.loadCatalogs();
    const provider2 = mgr2.getProvider(providerId)!;
    const gated2 = mgr2.applyModelGating(providerId, provider2.models);
    const gatedIds2 = gated2.map((m) => m.id);
    expect(gatedIds2).toContain(keep1);
    expect(gatedIds2).toContain(keep2);
    expect(gatedIds2).not.toContain(drop);
  });
});
