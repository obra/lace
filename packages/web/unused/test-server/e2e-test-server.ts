// ABOUTME: E2E test server that runs the main server with test-specific configuration
// ABOUTME: Keeps production server clean while allowing E2E tests to run in isolated mode

console.log('🧪 Starting E2E test server...');

// For E2E tests, we need a different approach that doesn't pollute production code
// The cleanest solution is to create separate E2E-specific API endpoints

// Import and run the main server
import './server';
