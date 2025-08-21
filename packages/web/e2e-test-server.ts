// ABOUTME: E2E test server that runs the main server with test-specific configuration
// ABOUTME: Keeps production server clean while allowing E2E tests to run in isolated mode

console.log('🧪 Starting E2E test server...');

// Set up test environment before importing any modules
process.env.NODE_ENV = 'production';

// Mock Anthropic API HTTP endpoints for E2E tests
import { mockAnthropicForE2E } from './e2e/helpers/anthropic-mock';
mockAnthropicForE2E();

// Import and run the main server
import './server-custom';
