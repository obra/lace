const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const PLATFORM_RE = /^[a-z0-9]+\/[a-z0-9]+(?:\/[a-z0-9._-]+)?$/;

export class RuntimeImageIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeImageIdentityError';
  }
}

export function validateResolvedImageDigest(value: string): string {
  if (!DIGEST_RE.test(value)) {
    throw new RuntimeImageIdentityError('resolvedImageDigest must be an immutable sha256 digest');
  }
  return value;
}

export function imageReferenceForResolvedDigest(
  requestedImage: string,
  resolvedImageDigest: string
): string {
  const digest = validateResolvedImageDigest(resolvedImageDigest);
  const imageName = repositoryNameFromRequestedImage(requestedImage);
  if (imageName.length === 0) {
    throw new RuntimeImageIdentityError('requestedImage must include an image name');
  }
  return `${imageName}@${digest}`;
}

export function normalizeImagePlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PLATFORM_RE.test(normalized)) {
    throw new RuntimeImageIdentityError('imagePlatform must use os/arch or os/arch/variant syntax');
  }
  return normalized;
}

function repositoryNameFromRequestedImage(value: string): string {
  const requestedImage = value.trim();
  const atIndex = requestedImage.indexOf('@');
  const withoutDigest = atIndex === -1 ? requestedImage : requestedImage.slice(0, atIndex);
  const lastSlashIndex = withoutDigest.lastIndexOf('/');
  const lastColonIndex = withoutDigest.lastIndexOf(':');

  if (lastColonIndex > lastSlashIndex) {
    return withoutDigest.slice(0, lastColonIndex);
  }

  return withoutDigest;
}
