export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironment: 'node',
  
  // Handle module path mapping for ESM
  moduleNameMapper: {
    '^(\\.+/.*)\\.js$': '$1',
    '^(\\.+/.*)\\.ts$': '$1',
    // Add explicit mappings for problematic modules
    '^sqlite3$': '<rootDir>/test/__mocks__/sqlite3.js',
    '^fullscreen-ink$': '<rootDir>/test/__mocks__/fullscreen-ink.js',
    '^../database/conversation-db.js$': '<rootDir>/test/__mocks__/conversation-db.js',
    '^../tools/tool-registry.js$': '<rootDir>/test/__mocks__/tool-registry.js', 
    '^../models/model-provider.js$': '<rootDir>/test/__mocks__/model-provider.js',
    '^../agents/agent.js$': '<rootDir>/test/__mocks__/agent.js',
    '^../../../src/logging/activity-logger.js$': '<rootDir>/src/logging/activity-logger.js'
  },
  
  // Transform all ESM modules in node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(ink-testing-library|ink-spinner|@inkjs/ui|ink|ansi-escapes|cli-truncate|string-width|strip-ansi|ansi-regex|chalk|fullscreen-ink|figures|is-unicode-supported|cli-spinners)/)'
  ],
  
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react-jsx',
        skipLibCheck: true,
        noImplicitAny: false,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true
      }
    }],
    '^.+\\.(js|jsx)$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-react'
      ]
    }]
  },
  
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: [
    '**/test/ui/**/*.test.(ts|tsx|js)',
    '**/test/unit/completion/**/*.test.(ts|tsx|js)',
    '**/test/unit/safety/**/*.test.(ts|tsx|js)',
    '**/test/**/*.test.(ts|tsx|js)'
  ],
  
  // Better error reporting
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};
