export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(ink-testing-library|ink-spinner|@inkjs/ui|ink|ansi-escapes|cli-truncate|string-width|strip-ansi|ansi-regex)/)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react-jsx',
        skipLibCheck: true,
        noImplicitAny: false,
        moduleResolution: 'node'
      }
    }],
    '^.+\\.js$': ['ts-jest', {
      useESM: true
    }]
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: [
    '**/test/ui/**/*.test.(ts|tsx|js)',
    '**/test/unit/**/*.test.(ts|tsx|js)'
  ]
};