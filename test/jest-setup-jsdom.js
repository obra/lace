// ABOUTME: Jest setup file specifically for React/jsdom tests
// ABOUTME: Configures React Testing Library and suppresses act() warnings

import { jest } from '@jest/globals'

// Configure React Testing Library
process.env.NODE_ENV = 'test'

// Suppress React act() warnings in tests by setting the global flag
global.IS_REACT_ACT_ENVIRONMENT = true

// Mock console methods for cleaner test output (unless verbose)
if (!process.env.VERBOSE_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}

// Set longer timeout for React component tests
jest.setTimeout(15000)
