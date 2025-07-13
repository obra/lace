// ABOUTME: Test setup for web interface components
// ABOUTME: Configures testing environment for React components and hooks

import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Global beforeEach setup
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Mock window.localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock document.documentElement.setAttribute for theme setting
Object.defineProperty(document.documentElement, 'setAttribute', {
  value: vi.fn(),
  writable: true,
});

// Mock Web Speech API
Object.defineProperty(window, 'SpeechRecognition', {
  value: vi.fn(() => ({
    continuous: false,
    interimResults: false,
    lang: 'en-US',
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onstart: null,
    onend: null,
    onerror: null,
    onresult: null,
  })),
  writable: true,
});

// Mock fetch for API calls
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    body: {
      getReader: () => ({
        read: () => Promise.resolve({ done: true, value: undefined }),
      }),
    },
  } as Response)
);

// Mock IntersectionObserver for Framer Motion
global.IntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
}));
