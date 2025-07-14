import { BashTool } from './dist/tools/implementations/bash.js';

async function test() {
  const tool = new BashTool();
  const result = await tool.execute({ command: 'echo "hello world"' });

  console.log('Result:', JSON.stringify(result, null, 2));

  if (result.content && result.content[0] && result.content[0].text) {
    console.log('Parsed output:', JSON.parse(result.content[0].text));
  }
}

test().catch(console.error);
