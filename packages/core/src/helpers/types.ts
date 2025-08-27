// ABOUTME: Type definitions for the helper system
// ABOUTME: Includes result types and options for different helper modes

import { ToolCall, ToolResult } from '~/tools/types';
import { CombinedTokenUsage } from '~/token-management/types';

/**
 * Result returned from a helper execution
 * Contains the final LLM response and details about any tool usage
 */
export interface HelperResult {
  /** The final text response from the LLM */
  content: string;
  
  /** All tool calls made during execution */
  toolCalls: ToolCall[];
  
  /** Results from those tool calls */
  toolResults: ToolResult[];
  
  /** Total token usage across all LLM calls */
  tokenUsage?: CombinedTokenUsage;
}