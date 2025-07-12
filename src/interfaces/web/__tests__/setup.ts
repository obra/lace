// ABOUTME: Test setup specific to web interface components
// ABOUTME: Mocks external dependencies that require browser APIs

import { vi } from 'vitest';

// Mock browser APIs that aren't available in jsdom
Object.defineProperty(window, 'SpeechRecognition', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window, 'webkitSpeechRecognition', {
  writable: true,
  value: vi.fn(),
});