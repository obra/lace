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

export function normalizeImagePlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PLATFORM_RE.test(normalized)) {
    throw new RuntimeImageIdentityError('imagePlatform must use os/arch or os/arch/variant syntax');
  }
  return normalized;
}
