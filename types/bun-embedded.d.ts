// ABOUTME: Type definitions for Bun embedded files API
// ABOUTME: Eliminates need for @ts-ignore comments when using Bun.embeddedFiles

declare const Bun: {
  embeddedFiles?: ReadonlyArray<{ name: string; text(): Promise<string> }>;
};