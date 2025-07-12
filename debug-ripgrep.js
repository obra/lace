import { RipgrepSearchTool } from './dist/tools/implementations/ripgrep-search.js';

const tool = new RipgrepSearchTool();

// Create test file
import { writeFileSync, mkdirSync } from 'fs';
try {
  mkdirSync('test-debug', { recursive: true });
  writeFileSync('test-debug/test.js', 'function hello() { console.log("test"); }');
  
  console.log('Testing ripgrep tool...');
  const result = await tool.execute({ pattern: 'hello', path: 'test-debug' });
  
  console.log('Result isError:', result.isError);
  console.log('Result content:', JSON.stringify(result.content, null, 2));
  
  if (result.isError) {
    console.log('Error details:', result.content[0]?.text);
  }
} catch (error) {
  console.error('Error running test:', error);
}
