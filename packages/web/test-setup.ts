// ABOUTME: Test setup for vitest
// ABOUTME: Global test configuration and mocks for server-only modules

import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock server-only to avoid import issues in tests
// This is the current workaround as suggested in Next.js GitHub issue #60038
vi.mock('server-only', () => {
  return {};
});
