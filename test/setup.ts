// ABOUTME: Jest test setup file for UI tests
// ABOUTME: Configures testing environment and global mocks

import { jest } from '@jest/globals';

// Mock timers for testing setTimeout behavior
jest.useFakeTimers();