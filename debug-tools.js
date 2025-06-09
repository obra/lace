// Debug script to test tool registry
import { ToolRegistry } from './src/tools/tool-registry.js';

async function debugTools() {
  console.log('Creating ToolRegistry...');
  const tools = new ToolRegistry();
  
  console.log('Initializing...');
  await tools.initialize();
  
  console.log('Listing tools:');
  const toolsList = tools.listTools();
  console.log('Tools:', toolsList);
  
  console.log('Checking schemas:');
  for (const toolName of toolsList) {
    const schema = tools.getToolSchema(toolName);
    console.log(`${toolName} schema:`, schema ? 'Available' : 'Missing');
    if (schema) {
      console.log(`  - Methods:`, Object.keys(schema.methods || {}));
    }
  }
}

debugTools().catch(console.error);