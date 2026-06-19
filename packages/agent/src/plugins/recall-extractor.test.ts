// ABOUTME: Tests the recall membership-extractor registrar + resolveRecallExtractor helper
import { describe, it, expect, afterEach } from 'vitest';
import { createPluginApi, makeRegistries, registries } from './api';
import {
  resolveRecallExtractor,
  RECALL_EXTRACTOR_NAME,
} from '../tools/implementations/recall-extractor';
import { resetRegistriesForTest } from './api';
import type { RecallMembershipExtractor } from './api';

const META = { name: 'demo', namespace: 'demo', version: '1.0.0' };

describe('recall membership-extractor registrar', () => {
  afterEach(() => {
    resetRegistriesForTest();
  });

  it('registers, resolves, and runs an extractor through a PluginApi view', () => {
    const local = makeRegistries();
    const api = createPluginApi(META, local);
    const extractor: RecallMembershipExtractor = (events, key) =>
      events.flatMap((e, i) => ((e as { track?: string }).track === key ? [i] : []));
    api.recall.register(RECALL_EXTRACTOR_NAME, extractor);
    expect(local.recall.has(RECALL_EXTRACTOR_NAME)).toBe(true);
    expect(local.recall.owner(RECALL_EXTRACTOR_NAME)).toBe('demo');
    const resolved = local.recall.resolve(RECALL_EXTRACTOR_NAME);
    expect(resolved([{ track: 'K' }, { track: 'X' }, { track: 'K' }], 'K')).toEqual([0, 2]);
  });

  it('resolveRecallExtractor reads the process-wide registry; resetRegistriesForTest clears it', () => {
    expect(resolveRecallExtractor()).toBeUndefined();
    const extractor: RecallMembershipExtractor = () => [42];
    createPluginApi(META, registries).recall.register(RECALL_EXTRACTOR_NAME, extractor);
    const got = resolveRecallExtractor();
    expect(got).toBeDefined();
    expect(got!([], 'anything')).toEqual([42]);
    resetRegistriesForTest();
    expect(resolveRecallExtractor()).toBeUndefined();
  });
});
