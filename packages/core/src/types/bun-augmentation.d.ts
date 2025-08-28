// ABOUTME: Type augmentation for Bun.embeddedFiles missing from @types/bun
// ABOUTME: Provides proper types for embedded files with name property and text() method

interface BunEmbeddedFile extends Blob {
  readonly name: string;
  text(): Promise<string>;
}

declare global {
  namespace Bun {
    const embeddedFiles: ReadonlyArray<BunEmbeddedFile>;
  }
}

export {};