// ABOUTME: Manual test script for todo tools with Claude Haiku
// ABOUTME: Run with: npx tsx src/todo/__tests__/haiku-tool-test.ts
//
// This tests whether Haiku correctly understands and uses the todo tools.
// Requires ANTHROPIC_API_KEY environment variable.

/* eslint-disable no-console -- Manual CLI test script outputs results to console */

import Anthropic from '@anthropic-ai/sdk';
import { TodoReadTool } from '../../tools/implementations/todo_read';
import { TodoAddTool } from '../../tools/implementations/todo_add';
import { TodoUpdateTool } from '../../tools/implementations/todo_update';
import { TodoRemoveTool } from '../../tools/implementations/todo_remove';

const client = new Anthropic();

// Convert our tool definitions to Anthropic format
function toolToAnthropicFormat(tool: { name: string; description: string; inputSchema: unknown }) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  };
}

const tools = [new TodoReadTool(), new TodoAddTool(), new TodoUpdateTool(), new TodoRemoveTool()];

const anthropicTools = tools.map(toolToAnthropicFormat);

interface TestCase {
  name: string;
  prompt: string;
  expectedTool?: string;
  expectedParams?: Record<string, unknown>;
  shouldNotUseTool?: boolean;
}

const testCases: TestCase[] = [
  // Basic understanding tests
  {
    name: 'Should use todo_add when asked to plan a task',
    prompt:
      'I need to implement a login system. Add this to your task list so you can track the work.',
    expectedTool: 'todo_add',
  },
  {
    name: 'Should use todo_read when asked about current tasks',
    prompt: "What tasks do you have on your list right now? Check what you're working on.",
    expectedTool: 'todo_read',
  },
  {
    name: 'Should use todo_update to mark done',
    prompt: 'You just finished the task with ID t_abc. Mark it as complete in your task list.',
    expectedTool: 'todo_update',
    expectedParams: { id: 't_abc', done: true },
  },
  {
    name: 'Should use todo_remove to delete a task',
    prompt: 'Remove the task t_xyz from your list - it was added by mistake.',
    expectedTool: 'todo_remove',
    expectedParams: { id: 't_xyz' },
  },

  // Edge cases and nuance tests
  {
    name: 'Should create good task titles (not vague)',
    prompt: 'Add a task to fix the bug where users cannot reset their passwords.',
    expectedTool: 'todo_add',
    // We'll check that title is specific, not vague like "fix bug"
  },
  {
    name: 'Should understand todo_read before update',
    prompt: 'Mark my first task as done. You may need to check the list first to find the ID.',
    expectedTool: 'todo_read', // Should read first to get IDs
  },
  {
    name: 'Should NOT use todo tools for simple questions',
    prompt: 'What is the capital of France?',
    shouldNotUseTool: true, // Simple question, no task tracking needed
  },
  {
    name: 'Should add multiple tasks when given a multi-step plan',
    prompt:
      'You need to: 1) Create database schema, 2) Implement API endpoints, 3) Write tests. Add these to your task list.',
    expectedTool: 'todo_add', // Should call todo_add (possibly multiple times)
  },
  {
    name: 'Should understand marking incomplete',
    prompt: "The task t_123 isn't actually done yet - mark it as incomplete.",
    expectedTool: 'todo_update',
    expectedParams: { id: 't_123', done: false },
  },
  {
    name: 'Should prefer marking done over removing',
    prompt: 'The task t_456 is finished. Update your task list.',
    expectedTool: 'todo_update', // Should mark done, not remove
    expectedParams: { done: true },
  },
];

async function runTest(testCase: TestCase): Promise<{ passed: boolean; details: string }> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: anthropicTools,
      messages: [
        {
          role: 'user',
          content: testCase.prompt,
        },
      ],
    });

    // Check if tool was used
    const toolUse = response.content.find((block) => block.type === 'tool_use');

    if (testCase.shouldNotUseTool) {
      if (toolUse) {
        return {
          passed: false,
          details: `Expected no tool use, but got: ${toolUse.name}`,
        };
      }
      return { passed: true, details: 'Correctly did not use todo tools' };
    }

    if (!toolUse) {
      return {
        passed: false,
        details: `Expected tool ${testCase.expectedTool}, but no tool was used. Response: ${JSON.stringify(response.content)}`,
      };
    }

    if (testCase.expectedTool && toolUse.name !== testCase.expectedTool) {
      return {
        passed: false,
        details: `Expected tool ${testCase.expectedTool}, got ${toolUse.name}`,
      };
    }

    // Check expected parameters if specified
    if (testCase.expectedParams) {
      const input = toolUse.input as Record<string, unknown>;
      for (const [key, value] of Object.entries(testCase.expectedParams)) {
        if (input[key] !== value) {
          return {
            passed: false,
            details: `Expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(input[key])}. Full input: ${JSON.stringify(input)}`,
          };
        }
      }
    }

    // For todo_add, check that title is reasonably specific
    if (toolUse.name === 'todo_add') {
      const input = toolUse.input as { title?: string };
      if (input.title) {
        const vaguePatterns = [
          /^(do stuff|work on stuff|the thing|todo|task)$/i, // Completely vague
          /^.{1,8}$/, // Too short (less than 9 chars)
        ];
        for (const pattern of vaguePatterns) {
          if (pattern.test(input.title)) {
            return {
              passed: false,
              details: `Task title seems too vague: "${input.title}"`,
            };
          }
        }
      }
    }

    return {
      passed: true,
      details: `Used ${toolUse.name} with input: ${JSON.stringify(toolUse.input)}`,
    };
  } catch (error) {
    return {
      passed: false,
      details: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main() {
  console.log('Testing todo tools with Claude Haiku 4.5\n');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    process.stdout.write(`\n${testCase.name}... `);

    const result = await runTest(testCase);

    if (result.passed) {
      console.log('✅ PASSED');
      console.log(`   ${result.details}`);
      passed++;
    } else {
      console.log('❌ FAILED');
      console.log(`   ${result.details}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
