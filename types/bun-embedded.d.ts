// ABOUTME: Global type augmentation for Bun embedded files API
// ABOUTME: Provides types for Bun.embeddedFiles in TypeScript projects

// This file extends the global Bun namespace for embedded file support
// Required for projects that use both Bun and Node.js environments

declare global {
  namespace Bun {
    interface EmbeddedFile {
      name: string;
      text(): Promise<string>;
    }
    
    const embeddedFiles: ReadonlyArray<EmbeddedFile> | undefined;
  }
}

// Mark this as a module to enable global augmentation
export {};