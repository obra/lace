export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    experimentalVmModules: true
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react-jsx',
        skipLibCheck: true,
        noImplicitAny: false,
        moduleResolution: 'node'
      }
    }]
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: [
    '**/test/ui/**/*.test.(ts|tsx|js)'
  ]
};