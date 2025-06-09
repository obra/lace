// Simple debug test without Jest dependencies
import { ToolRegistry } from './src/tools/tool-registry.js';
import { ConversationDB } from './src/database/conversation-db.js';
import { Agent } from './src/agents/agent.ts';

async function testComponents() {
  console.log('Testing ToolRegistry initialization...');
  const tools = new ToolRegistry();
  await tools.initialize();
  console.log('✅ ToolRegistry initialized');

  console.log('Testing ConversationDB initialization...');
  const db = new ConversationDB(':memory:');
  await db.initialize();
  console.log('✅ ConversationDB initialized');

  console.log('Testing Agent creation...');
  const agent = new Agent({
    generation: 0,
    tools,
    db,
    modelProvider: null,
    verbose: false,
    role: 'general',
    assignedModel: 'test-model',
    assignedProvider: 'test',
    capabilities: ['testing']
  });
  console.log('✅ Agent created');

  await db.close();
  console.log('✅ All tests passed');
}

testComponents().catch(console.error);