export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  testEnvironment: "node",

  // Handle module path mapping for ESM
  moduleNameMapper: {
    //  '^(\\.{1,2}/.*)\\.js$': '$1',
    // Add explicit mappings for problematic modules
    "^fullscreen-ink$": "<rootDir>/test/with-mocks/__mocks__/fullscreen-ink.js",
    "^../database/conversation-db.js$":
      "<rootDir>/test/with-mocks/__mocks__/conversation-db.js",
    "^../tools/tool-registry.js$":
      "<rootDir>/test/with-mocks/__mocks__/tool-registry.js",
    "^../models/model-provider.js$":
      "<rootDir>/test/with-mocks/__mocks__/model-provider.js",
    "^../agents/agent.js$": "<rootDir>/test/with-mocks/__mocks__/agent.js",
    // Add path mappings for cleaner imports
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@test/(.*)$": "<rootDir>/test/$1",
  },
  resolver: "jest-ts-webcompat-resolver",

  // Transform all ESM modules in node_modules
  transformIgnorePatterns: [
    "node_modules/(?!(ink-testing-library|ink-spinner|@inkjs/ui|ink|ansi-escapes|cli-truncate|string-width|strip-ansi|ansi-regex|chalk|fullscreen-ink|figures|is-unicode-supported|cli-spinners)/)",
  ],

  transform: {
    "^.+\\.(ts|tsx|js|jsx)$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          jsx: "react-jsx",
          skipLibCheck: true,
          noImplicitAny: false,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          allowJs: true,
        },
      },
    ],
  },

  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  testMatch: ["**/test/with-mocks/**/*.test.(ts|tsx|js)"],

  // Better error reporting
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
