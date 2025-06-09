// Debug test to isolate hanging issue
import { TestHarness } from './test/test-harness.js';

async function testHarnessComponents() {
  console.log('Starting debug test...');
  const harness = new TestHarness();
  
  try {
    console.log('Creating test agent...');
    const startTime = Date.now();
    
    const agent = await harness.createTestAgent({
      role: 'planning',
      assignedModel: 'test-model'
    });
    
    const endTime = Date.now();
    console.log(`Agent created successfully in ${endTime - startTime}ms`);
    console.log('Agent role:', agent.role);
    
    await harness.cleanup();
    console.log('Test completed successfully');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testHarnessComponents();