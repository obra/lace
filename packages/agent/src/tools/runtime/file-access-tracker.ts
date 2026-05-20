import type { RuntimePath } from './types';

export class FileAccessTracker {
  private readonly readKeys = new Set<string>();

  markRead(_path: RuntimePath, canonicalKey: string): void {
    this.readKeys.add(canonicalKey);
  }

  hasRead(_path: RuntimePath, canonicalKey: string): boolean {
    return this.readKeys.has(canonicalKey);
  }
}
