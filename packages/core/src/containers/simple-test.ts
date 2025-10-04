// ABOUTME: Manual test script for Apple Container runtime without volume mounts
// ABOUTME: Can be run directly with `npx tsx src/containers/simple-test.ts` for debugging

import { AppleContainerRuntime } from './apple-container';
import { logger } from '@lace/core/utils/logger';

async function test() {
  const runtime = new AppleContainerRuntime();

  logger.info('Creating container without mounts...');
  const containerId = runtime.create({
    id: 'simple-test',
    workingDirectory: '/tmp',
    mounts: [], // No mounts
    environment: {
      TEST_VAR: 'hello',
    },
  });

  logger.info('Starting container:', { containerId });
  await runtime.start(containerId);

  try {
    logger.info('Executing echo...');
    const result = await runtime.exec(containerId, {
      command: ['echo', 'Hello World'],
    });
    logger.info('Result:', { result });

    logger.info('Executing env check...');
    const result2 = await runtime.exec(containerId, {
      command: ['sh', '-c', 'echo "TEST_VAR=$TEST_VAR"'],
    });
    logger.info('Result2:', { result2 });

    if (result.exitCode === 0 && result.stdout.includes('Hello World')) {
      logger.info('✅ SUCCESS! Container works!');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed:', { error: errorMessage });
  } finally {
    await runtime.stop(containerId);
    await runtime.remove(containerId);
  }
}

// Only run when executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  test().catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Test failed:', { error: errorMessage });
    process.exit(1);
  });
}
