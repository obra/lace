#!/usr/bin/env node
// ABOUTME: Debug tool for inspecting thread conversations and token counts
// ABOUTME: Outputs thread data in JSON or readable format with provider-specific conversation structure

import { Command } from 'commander';
import { ThreadManager } from '~/threads/thread-manager.js';
import { Agent } from '~/agents/agent.js';
import { ProviderRegistry } from '~/providers/registry.js';
import { estimateTokens } from '~/utils/token-estimation.js';
import { convertToAnthropicFormat } from '~/providers/format-converters.js';
import { getLaceDir } from '~/config/lace-dir.js';
import { join } from 'path';
import { loadEnvFile } from '~/config/env-loader.js';
import { ToolExecutor } from '~/tools/executor.js';
import { ProviderMessage } from '~/providers/base-provider.js';
import { ThreadEvent } from '~/threads/types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DebugOptions {
  threadId: string;
  provider: string;
  format: 'json' | 'text';
  output?: string;
}

interface ThreadDebugInfo {
  threadId: string;
  canonicalId: string;
  provider: string;
  format: string;
  eventCount: number;
  tokenCounts: {
    estimated: number;
    breakdown: {
      userMessages: number;
      agentMessages: number;
      toolCalls: number;
      toolResults: number;
      systemPrompts: number;
    };
  };
  conversation: any;
  rawEvents: any[];
}

async function debugThread(options: DebugOptions): Promise<ThreadDebugInfo> {
  // Load environment variables
  loadEnvFile();

  // Initialize database and thread manager
  const laceDir = getLaceDir();
  const dbPath = join(laceDir, 'lace.db');
  const threadManager = new ThreadManager(dbPath);

  // Load thread events
  const thread = threadManager.getThread(options.threadId);
  if (!thread) {
    throw new Error(`Thread ${options.threadId} not found`);
  }

  // Get canonical ID
  const canonicalId = threadManager.getCanonicalId(options.threadId);

  // Initialize provider registry and get provider
  const registry = await ProviderRegistry.createWithAutoDiscovery();
  const provider = registry.getProvider(options.provider);
  if (!provider) {
    throw new Error(`Provider ${options.provider} not found`);
  }

  // Build conversation using Agent's buildConversationFromEvents
  // We'll create a minimal agent instance just to access this method
  const agent = new Agent({
    provider,
    toolExecutor: undefined as unknown as ToolExecutor, // We don't need tools for debug
    threadManager,
    threadId: options.threadId,
    tools: [],
  });

  // Access the private method through reflection
  const agentWithPrivates = agent as unknown as {
    _buildConversationFromEvents: (events: any[]) => any;
  };

  const buildConversationFromEvents = agentWithPrivates._buildConversationFromEvents.bind(agent);

  const providerMessages = buildConversationFromEvents(thread.events);

  // Calculate token counts
  const tokenCounts = calculateTokenCounts(thread.events, providerMessages);

  // Convert to provider-specific format if needed
  let conversation: ProviderMessage[] | unknown = providerMessages;

  if (options.provider === 'anthropic') {
    conversation = convertToAnthropicFormat(providerMessages);
  } else if (options.provider === 'openai') {
    // OpenAI format conversion would go here
    // For now, keep as generic ProviderMessage format
  }

  return {
    threadId: options.threadId,
    canonicalId,
    provider: options.provider,
    format: options.format,
    eventCount: thread.events.length,
    tokenCounts,
    conversation,
    rawEvents: thread.events,
  };
}

function calculateTokenCounts(
  events: ThreadEvent[],
  providerMessages: ProviderMessage[]
): {
  estimated: number;
  breakdown: {
    userMessages: number;
    agentMessages: number;
    toolCalls: number;
    toolResults: number;
    systemPrompts: number;
  };
} {
  let userMessages = 0;
  let agentMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let systemPrompts = 0;

  // Count tokens from events
  events.forEach((event) => {
    const content = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    const tokens = estimateTokens(content);

    switch (event.type) {
      case 'USER_MESSAGE':
        userMessages += tokens;
        break;
      case 'AGENT_MESSAGE':
        agentMessages += tokens;
        break;
      case 'TOOL_CALL':
        toolCalls += tokens;
        break;
      case 'TOOL_RESULT':
        toolResults += tokens;
        break;
      case 'SYSTEM_PROMPT':
      case 'USER_SYSTEM_PROMPT':
        systemPrompts += tokens;
        break;
    }
  });

  // Calculate total from provider messages
  const totalEstimated = providerMessages.reduce((sum, msg) => {
    const content = msg.content || '';
    const toolCallsContent = msg.toolCalls ? JSON.stringify(msg.toolCalls) : '';
    const toolResultsContent = msg.toolResults ? JSON.stringify(msg.toolResults) : '';

    return (
      sum +
      estimateTokens(content) +
      estimateTokens(toolCallsContent) +
      estimateTokens(toolResultsContent)
    );
  }, 0);

  return {
    estimated: totalEstimated,
    breakdown: {
      userMessages,
      agentMessages,
      toolCalls,
      toolResults,
      systemPrompts,
    },
  };
}

function formatAsText(debugInfo: ThreadDebugInfo): string {
  const lines: string[] = [];

  lines.push(`Thread Debug Report`);
  lines.push(`==================`);
  lines.push(`Thread ID: ${debugInfo.threadId}`);
  lines.push(`Canonical ID: ${debugInfo.canonicalId}`);
  lines.push(`Provider: ${debugInfo.provider}`);
  lines.push(`Event Count: ${debugInfo.eventCount}`);
  lines.push('');

  lines.push(`Token Counts:`);
  lines.push(`  Estimated Total: ${debugInfo.tokenCounts.estimated}`);
  lines.push(`  Breakdown:`);
  lines.push(`    User Messages: ${debugInfo.tokenCounts.breakdown.userMessages}`);
  lines.push(`    Agent Messages: ${debugInfo.tokenCounts.breakdown.agentMessages}`);
  lines.push(`    Tool Calls: ${debugInfo.tokenCounts.breakdown.toolCalls}`);
  lines.push(`    Tool Results: ${debugInfo.tokenCounts.breakdown.toolResults}`);
  lines.push(`    System Prompts: ${debugInfo.tokenCounts.breakdown.systemPrompts}`);
  lines.push('');

  lines.push(`Conversation (${debugInfo.provider} format):`);
  lines.push(`${'='.repeat(40)}`);

  if (Array.isArray(debugInfo.conversation)) {
    (debugInfo.conversation as Array<Record<string, unknown>>).forEach((msg, index) => {
      lines.push(`Message ${index + 1} (${(msg as { role: string }).role}):`);

      if (typeof msg.content === 'string') {
        lines.push(`  ${msg.content}`);
      } else if (Array.isArray(msg.content)) {
        (msg.content as Array<Record<string, unknown>>).forEach((block, blockIndex: number) => {
          lines.push(`  Block ${blockIndex + 1} (${(block as { type: string }).type}):`);
          if ((block as { text?: string }).text) {
            lines.push(`    ${(block as { text: string }).text}`);
          }
          if ((block as { tool_use_id?: string }).tool_use_id) {
            lines.push(`    Tool Use ID: ${(block as { tool_use_id: string }).tool_use_id}`);
          }
          if ((block as { name?: string }).name) {
            lines.push(`    Tool Name: ${(block as { name: string }).name}`);
          }
          if ((block as { input?: unknown }).input) {
            lines.push(
              `    Tool Input: ${JSON.stringify((block as { input: unknown }).input, null, 2)}`
            );
          }
        });
      }

      if (
        (msg as { toolCalls?: unknown[] }).toolCalls?.length &&
        (msg as { toolCalls: unknown[] }).toolCalls.length > 0
      ) {
        lines.push(`  Tool Calls: ${(msg as { toolCalls: unknown[] }).toolCalls.length}`);
        (msg as { toolCalls: Array<{ name: string; input: unknown }> }).toolCalls.forEach(
          (call, callIndex: number) => {
            lines.push(`    ${callIndex + 1}. ${call.name}:`);
            lines.push(`       Input: ${JSON.stringify(call.input, null, 2)}`);
          }
        );
      }

      if (
        (msg as { toolResults?: unknown[] }).toolResults?.length &&
        (msg as { toolResults: unknown[] }).toolResults.length > 0
      ) {
        lines.push(`  Tool Results: ${(msg as { toolResults: unknown[] }).toolResults.length}`);
        (
          msg as { toolResults: Array<{ id: string; content?: Array<{ text?: string }> }> }
        ).toolResults.forEach((result, resultIndex: number) => {
          lines.push(`    ${resultIndex + 1}. ${result.id}:`);
          if (result.content) {
            result.content.forEach((contentBlock: { text?: string }, contentIndex: number) => {
              lines.push(
                `       Content ${contentIndex + 1}: ${contentBlock.text || JSON.stringify(contentBlock)}`
              );
            });
          }
          if ((result as { isError?: boolean }).isError) {
            lines.push(`       Error: true`);
          }
        });
      }

      lines.push('');
    });
  }

  lines.push(`Raw Events:`);
  lines.push(`${'='.repeat(40)}`);
  debugInfo.rawEvents.forEach((event, index) => {
    lines.push(
      `Event ${index + 1}: ${(event as { type: string; timestamp: string }).type} (${(event as { type: string; timestamp: string }).timestamp})`
    );
    if (typeof (event as { data: unknown }).data === 'string') {
      lines.push(`  ${(event as { data: string }).data}`);
    } else {
      lines.push(`  ${JSON.stringify((event as { data: unknown }).data, null, 2)}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

async function main() {
  const program = new Command();

  program
    .name('debug-thread')
    .description('Debug tool for inspecting thread conversations and token counts')
    .version('1.0.0');

  program
    .requiredOption('-t, --thread-id <threadId>', 'Thread ID to debug')
    .requiredOption(
      '-p, --provider <provider>',
      'Provider to use for conversation format (anthropic, openai, lmstudio, ollama)'
    )
    .option('-f, --format <format>', 'Output format (json or text)', 'json')
    .option('-o, --output <file>', 'Output file path (defaults to stdout)');

  // Show help if no arguments provided
  if (process.argv.length <= 2) {
    program.help();
    return;
  }

  program.parse();

  const options = program.opts();

  try {
    const debugInfo = await debugThread(options as DebugOptions);

    let output: string;
    if (options.format === 'json') {
      output = JSON.stringify(debugInfo, null, 2);
    } else {
      output = formatAsText(debugInfo);
    }

    if (options.output) {
      const fs = await import('fs');
      fs.writeFileSync(options.output, output);
      console.warn(`Debug output written to ${options.output}`);
    } else {
      console.warn(output);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
