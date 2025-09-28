// Simpler test without volume mounts
import { AppleContainerRuntime } from '~/containers/apple-container';

async function test() {
  const runtime = new AppleContainerRuntime();

  console.log('Creating container without mounts...');
  const containerId = runtime.create({
    id: 'simple-test',
    workingDirectory: '/tmp',
    mounts: [], // No mounts
    environment: {
      TEST_VAR: 'hello',
    },
  });

  console.log('Starting container:', containerId);
  await runtime.start(containerId);

  try {
    console.log('Executing echo...');
    const result = await runtime.exec(containerId, {
      command: ['echo', 'Hello World'],
    });
    console.log('Result:', result);

    console.log('\nExecuting env check...');
    const result2 = await runtime.exec(containerId, {
      command: ['sh', '-c', 'echo "TEST_VAR=$TEST_VAR"'],
    });
    console.log('Result2:', result2);

    if (result.exitCode === 0 && result.stdout.includes('Hello World')) {
      console.log('\n✅ SUCCESS! Container works!');
    }
  } catch (error: any) {
    console.error('Failed:', error.message);
  } finally {
    await runtime.stop(containerId);
    await runtime.remove(containerId);
  }
}

test().catch(console.error);
