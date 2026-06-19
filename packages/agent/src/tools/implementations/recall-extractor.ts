// ABOUTME: Recall membership-extractor seam — reach the plugin registry from the recall tool
// ABOUTME: Kernel stays opaque to the key; sen-core registers the (Slack-aware) extractor.
import { registries } from '@lace/agent/plugins';
import type { RecallMembershipExtractor } from '@lace/agent/plugins/api';

/** The constant under which the single membership extractor is registered. */
export const RECALL_EXTRACTOR_NAME = 'default';

/**
 * Resolve the registered membership extractor, or `undefined` when no plugin
 * registered one. The recall `thread` action turns `undefined` into a LOUD
 * not-registered envelope rather than a silent empty result.
 */
export function resolveRecallExtractor(): RecallMembershipExtractor | undefined {
  if (!registries.recall.has(RECALL_EXTRACTOR_NAME)) return undefined;
  return registries.recall.resolve(RECALL_EXTRACTOR_NAME);
}
