import { normalizeImagePlatform, validateResolvedImageDigest } from './image-identity';

export type ImageResolution =
  | { kind: 'manifest'; digest: string; platform: string }
  | { kind: 'index'; manifests: Array<{ platform: string; digest: string }> }
  | { kind: 'local-tag-only' };

export interface ContainerImageResolutionAdapter {
  resolveImage(input: { requestedImage: string; imagePlatform: string }): Promise<ImageResolution>;
}

export async function resolveContainerImageIdentity(input: {
  requestedImage: string;
  imagePlatform: string;
  adapter: ContainerImageResolutionAdapter;
}): Promise<{
  requestedImage: string;
  resolvedImageDigest: string;
  imagePlatform: string;
}> {
  const imagePlatform = normalizeImagePlatform(input.imagePlatform);
  const resolution = await input.adapter.resolveImage({
    requestedImage: input.requestedImage,
    imagePlatform,
  });

  if (resolution.kind === 'manifest') {
    if (normalizeImagePlatform(resolution.platform) !== imagePlatform) {
      throw new Error(`Image platform mismatch: ${resolution.platform} is not ${imagePlatform}`);
    }
    return {
      requestedImage: input.requestedImage,
      resolvedImageDigest: validateResolvedImageDigest(resolution.digest),
      imagePlatform,
    };
  }

  if (resolution.kind === 'index') {
    const match = resolution.manifests.find(
      (manifest) => normalizeImagePlatform(manifest.platform) === imagePlatform
    );
    if (!match) throw new Error(`No image manifest found for platform ${imagePlatform}`);
    return {
      requestedImage: input.requestedImage,
      resolvedImageDigest: validateResolvedImageDigest(match.digest),
      imagePlatform,
    };
  }

  throw new Error('Projected container runtime requires an immutable digest');
}
