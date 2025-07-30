// ABOUTME: Tool renderer routing - maps tool types to specialized components
// ABOUTME: Simple switch function to render different tool outputs appropriately

import { ReactNode } from 'react';
import BashTool from './bash';
import DefaultTool from './default';

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  id?: string;
}

export function renderToolResult(toolName: string, result: ToolResult): ReactNode {
  switch (toolName.toLowerCase()) {
    case 'bash':
      return <BashTool result={result} />;
    default:
      return <DefaultTool result={result} />;
  }
}