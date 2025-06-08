// ABOUTME: Jest configuration for Lace testing
// ABOUTME: Configures ES modules support, test patterns, and environment setup

export default {
  // Test file patterns
  testMatch: [
    '**/test/**/*.test.js'
  ],
  
  // Test environment
  testEnvironment: 'node',
  
  // Timeout for tests
  testTimeout: 20000,
  
  // Native ES modules support
  preset: null,
  
  // TypeScript transformation
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      isolatedModules: true
    }]
  },
  
  // Module name mapping for TypeScript files
  moduleNameMapping: {
    '^(.*)\\.ts$': '$1'
  },
  
  // Treat TypeScript files as ES modules
  extensionsToTreatAsEsm: ['.ts'],
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,

  // Module file extensions
  moduleFileExtensions: ['js', 'ts', 'json'],
  
  // Clear mocks automatically
  clearMocks: true
};