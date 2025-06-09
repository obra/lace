export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironment: 'node',
  
  // NO module name mapping for integration tests - use real implementations
  // But add path mapping for cleaner imports
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1'
  },
  
  resolver: 'jest-ts-webcompat-resolver',
 
  // Transform all ESM modules in node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(ink-testing-library|ink-spinner|@inkjs/ui|ink|ansi-escapes|cli-truncate|string-width|strip-ansi|ansi-regex|chalk|fullscreen-ink|figures|is-unicode-supported|cli-spinners)/)'
  ],
  
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react-jsx',
        skipLibCheck: true,
        noImplicitAny: false,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        allowJs: true
      }
    }]
  },
  
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: [
    '**/test/no-mocks/**/*.test.(ts|tsx|js)'
  ],
  
  // Better error reporting
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};