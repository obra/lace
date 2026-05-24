// ABOUTME: Helpers for non-replayable container execution identity metadata.

import { createHash } from 'node:crypto';

export function fingerprintContainerExecutionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
