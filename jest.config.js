// ABOUTME: Jest configuration for Lace web companion testing
// ABOUTME: Configures ES modules support, test patterns, and environment setup

export default {
  // Test file patterns - only test our new web companion tests
  testMatch: [
    '**/test/unit/web-companion-basic.test.js',
    '**/test/unit/web-api-endpoints.test.js'
  ],
  
  // Test environment
  testEnvironment: 'node',
  
  // Timeout for tests
  testTimeout: 10000,
  
  // Transform configuration - use babel for ES modules
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,

  // Module file extensions
  moduleFileExtensions: ['js', 'json'],
  
  // Clear mocks automatically
  clearMocks: true
};