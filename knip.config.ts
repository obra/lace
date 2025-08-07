export default {
  entry: [
    'src/main.ts',
    'src/interfaces/**/*.ts',
    'src/tools/implementations/index.ts',
    // Keep stream-events - used by web package
    'src/stream-events/types.ts',
  ],
  project: ['src/**/*.ts'],
  ignore: ['packages/**', 'dist/**', 'node_modules/**'],
};
