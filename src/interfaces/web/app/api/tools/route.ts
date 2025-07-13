// ABOUTME: API route for tool management and execution using Agent service pattern
// ABOUTME: Provides tool listing and execution capabilities through proper encapsulation

import { NextRequest, NextResponse } from 'next/server';
import { sharedAgentService } from '~/interfaces/web/lib/agent-service';
import { ToolCall, ToolResult } from '~/tools/types';
import { ApprovalDecision, ApprovalCallback } from '~/tools/approval-types';
import { asThreadId } from '~/threads/types';
import { logger } from '~/utils/logger';

interface ExecuteToolRequest {
  name: string;
  parameters: Record<string, unknown>;
  id?: string;
  autoApprove?: boolean;
}

// ToolInfo interface removed - using sharedAgentService.getAvailableTools() return type

// GET endpoint to list available tools through agent service
export function GET(): NextResponse {
  try {
    // Get tools through shared agent service
    const toolInfo = sharedAgentService.getAvailableTools();

    return NextResponse.json({
      tools: toolInfo,
      count: toolInfo.length,
    });
  } catch (error) {
    logger.error('API tools list error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list tools',
      },
      { status: 500 }
    );
  }
}

// POST endpoint to execute a tool through agent service
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExecuteToolRequest;

    if (!body.name) {
      return NextResponse.json({ error: 'Tool name is required' }, { status: 400 });
    }

    if (!body.parameters) {
      return NextResponse.json({ error: 'Tool parameters are required' }, { status: 400 });
    }

    // Get tool executor through shared agent service
    const toolExecutor = sharedAgentService.getToolExecutor();

    // Create tool call
    const toolCall: ToolCall = {
      id: body.id || `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: body.name,
      arguments: body.parameters,
    };

    // Setup approval callback
    if (body.autoApprove) {
      // Auto-approve all tool calls
      const approvalCallback: ApprovalCallback = {
        // eslint-disable-next-line @typescript-eslint/require-await -- This function must be async to match ApprovalCallback interface but doesn't need await
        requestApproval: async (): Promise<ApprovalDecision> => ApprovalDecision.ALLOW_ONCE,
      };
      toolExecutor.setApprovalCallback(approvalCallback);
    } else {
      // For API usage, we'll auto-approve non-destructive tools
      // and require explicit approval for destructive ones
      const approvalCallback: ApprovalCallback = {
        // eslint-disable-next-line @typescript-eslint/require-await -- This function must be async to match ApprovalCallback interface but doesn't need await
        requestApproval: async (toolName: string): Promise<ApprovalDecision> => {
          const tool = toolExecutor.getTool(toolName);
          if (tool?.annotations?.destructiveHint) {
            // Return error for destructive tools without explicit approval
            throw new Error(
              `Tool '${toolName}' requires explicit approval. Set autoApprove=true to bypass this check.`
            );
          }
          return ApprovalDecision.ALLOW_ONCE;
        },
      };
      toolExecutor.setApprovalCallback(approvalCallback);
    }

    // Execute the tool
    const result: ToolResult = await toolExecutor.executeTool(toolCall, {
      threadId: asThreadId('lace_api_call'),
    });

    return NextResponse.json({
      toolCall,
      result: {
        success: !result.isError,
        content: result.content,
        isError: result.isError,
        metadata: result.metadata,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('API tool execution error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to execute tool',
      },
      { status: 500 }
    );
  }
}
