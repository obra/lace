// ABOUTME: Jest configuration for Lace web companion testing
// ABOUTME: Configures ES modules support, test patterns, and environment setup

export default {
  // Test file patterns - web companion tests only
  testMatch: [
    '**/test/web-companion/**/*.test.js'
  ],
  
  // Test environment
  testEnvironment: 'node',
  
  // Timeout for tests
  testTimeout: 20000,
  
  // Native ES modules support
  preset: null,
  
  // No transformation - use native ES modules
  transform: {},
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,

  // Module file extensions
  moduleFileExtensions: ['js', 'json'],
  
  // Clear mocks automatically
  clearMocks: true
};