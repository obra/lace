import { describe, expect, it } from 'vitest';
import { protocolToolResultFromCore, coreToolResultFromProtocol } from '../../rpc/utils';
import { coreToolResultFromProtocol as compactedResult } from '../../compaction/toolkit';

describe('native memory source images', () => {
  it('preserves PNG bytes and media type through durable and compacted tool-result mapping', () => {
    const source = {
      status: 'completed' as const,
      content: [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }],
    };
    const durable = protocolToolResultFromCore(source);
    expect(durable.content).toEqual([{ type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' }]);
    expect(coreToolResultFromProtocol(durable, 'img').content).toEqual(source.content);
    expect(compactedResult(durable, 'img').content).toEqual(source.content);
  });
});
