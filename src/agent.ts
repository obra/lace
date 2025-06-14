#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';

const execAsync = promisify(exec);
const anthropic = new Anthropic({
  apiKey:
    process.env.ANTHROPIC_KEY ||
    (() => {
      console.error('ANTHROPIC_KEY required');
      process.exit(1);
    })(),
});
const conversation: Anthropic.MessageParam[] = [];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function callClaude(userMessage: string): Promise<string> {
  if (userMessage) conversation.push({ role: 'user', content: userMessage });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: conversation,
    system: 'You are a coding assistant. Use the bash tool to help with programming tasks.',
    tools: [
      {
        name: 'bash',
        description: 'Execute bash commands',
        input_schema: {
          type: 'object' as const,
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ],
  });
  conversation.push({ role: 'assistant', content: response.content });

  for (const content of response.content) {
    if (content.type === 'tool_use' && content.name === 'bash') {
      const { command } = content.input as { command: string };
      console.log(`\n🔧 Running: ${command}`);
      let output: string;
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 10485760,
        });
        output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      } catch (error: any) {
        output = `Error: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
      }
      console.log(output);
      conversation.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: content.id, content: output }],
      });
      return callClaude('');
    }
  }
  return response.content.find((content) => content.type === 'text')?.text || '';
}

console.log('🤖 Mini Agent started. Type "exit" to quit.\n');
(async () => {
  while (true) {
    const input = await new Promise<string>((resolve) => rl.question('> ', resolve));
    if (input.toLowerCase() === 'exit') {
      rl.close();
      break;
    }
    if (input.trim()) console.log(`\n${await callClaude(input)}\n`);
  }
})().catch(console.error);
