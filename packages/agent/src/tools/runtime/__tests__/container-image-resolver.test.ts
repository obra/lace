import { describe, expect, it, vi } from 'vitest';
import { resolveContainerImageIdentity } from '../container-image-resolver';

describe('container image resolver', () => {
  it('selects a platform child manifest from an index digest', async () => {
    const adapter = {
      resolveImage: vi.fn().mockResolvedValue({
        kind: 'index',
        manifests: [{ platform: 'linux/arm64', digest: 'sha256:' + 'a'.repeat(64) }],
      }),
    };

    await expect(
      resolveContainerImageIdentity({
        requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
        imagePlatform: 'linux/arm64',
        adapter,
      })
    ).resolves.toEqual({
      requestedImage: 'example/app@sha256:' + 'b'.repeat(64),
      resolvedImageDigest: 'sha256:' + 'a'.repeat(64),
      imagePlatform: 'linux/arm64',
    });
  });

  it('fails when a mutable local tag has no digest', async () => {
    const adapter = {
      resolveImage: vi.fn().mockResolvedValue({ kind: 'local-tag-only' }),
    };

    await expect(
      resolveContainerImageIdentity({
        requestedImage: 'local/dev:latest',
        imagePlatform: 'linux/arm64',
        adapter,
      })
    ).rejects.toThrow(/immutable digest/i);
  });
});
