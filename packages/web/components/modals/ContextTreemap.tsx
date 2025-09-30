// ABOUTME: Treemap visualization of context token usage
// ABOUTME: Shows proportional rectangles for each category with interactive tooltips and drill-down

'use client';

import React, { useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft } from '@/lib/fontawesome';
import type { ContextBreakdown } from '@/types/context';

interface TreemapData {
  name: string;
  size: number;
  fill: string;
  category?: string;
  [key: string]: string | number | undefined;
}

interface ContextTreemapProps {
  breakdown: ContextBreakdown;
}

export function ContextTreemap({ breakdown }: ContextTreemapProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Transform breakdown into recharts treemap format
  let data: TreemapData[] = [];

  // Use Tailwind color classes that match the progress bar
  const getCategoryFillColor = (category: string): string => {
    switch (category) {
      case 'systemPrompt':
        return '#a855f7'; // purple-500 (matches bg-primary)
      case 'coreTools':
        return '#ec4899'; // pink-500 (matches bg-secondary)
      case 'mcpTools':
        return '#f97316'; // orange-500 (matches bg-accent)
      case 'messages':
        return '#06b6d4'; // cyan-500 (matches bg-info)
      case 'reservedForResponse':
        return '#f59e0b'; // amber-500 (matches bg-warning)
      case 'freeSpace':
        return '#10b981'; // emerald-500 (matches bg-success)
      default:
        return '#6b7280'; // gray-500
    }
  };

  // Generate data based on view level
  if (!selectedCategory) {
    // Top level: show all categories
    if (breakdown.categories.systemPrompt.tokens > 0) {
      data.push({
        name: 'System Prompt',
        size: breakdown.categories.systemPrompt.tokens,
        fill: getCategoryFillColor('systemPrompt'),
        category: 'systemPrompt',
      });
    }

    if (breakdown.categories.coreTools.tokens > 0) {
      data.push({
        name: 'Core Tools',
        size: breakdown.categories.coreTools.tokens,
        fill: getCategoryFillColor('coreTools'),
        category: 'coreTools',
      });
    }

    if (breakdown.categories.mcpTools.tokens > 0) {
      data.push({
        name: 'MCP Tools',
        size: breakdown.categories.mcpTools.tokens,
        fill: getCategoryFillColor('mcpTools'),
        category: 'mcpTools',
      });
    }

    if (breakdown.categories.messages.tokens > 0) {
      data.push({
        name: 'Messages',
        size: breakdown.categories.messages.tokens,
        fill: getCategoryFillColor('messages'),
        category: 'messages',
      });
    }

    if (breakdown.categories.reservedForResponse.tokens > 0) {
      data.push({
        name: 'Reserved',
        size: breakdown.categories.reservedForResponse.tokens,
        fill: getCategoryFillColor('reservedForResponse'),
        category: 'reservedForResponse',
      });
    }

    if (breakdown.categories.freeSpace.tokens > 0) {
      data.push({
        name: 'Free Space',
        size: breakdown.categories.freeSpace.tokens,
        fill: getCategoryFillColor('freeSpace'),
        category: 'freeSpace',
      });
    }
  } else if (selectedCategory === 'coreTools' && breakdown.categories.coreTools.items) {
    // Drilled into core tools - show individual tools
    data = breakdown.categories.coreTools.items.map((tool) => ({
      name: tool.name,
      size: tool.tokens,
      fill: getCategoryFillColor('coreTools'),
    }));
  } else if (selectedCategory === 'mcpTools' && breakdown.categories.mcpTools.items) {
    // Drilled into MCP tools
    data = breakdown.categories.mcpTools.items.map((tool) => ({
      name: tool.name,
      size: tool.tokens,
      fill: getCategoryFillColor('mcpTools'),
    }));
  } else if (selectedCategory === 'messages') {
    // Drilled into messages - show subcategories
    const subcats = breakdown.categories.messages.subcategories;
    if (subcats.userMessages.tokens > 0) {
      data.push({
        name: 'User Messages',
        size: subcats.userMessages.tokens,
        fill: getCategoryFillColor('messages'),
      });
    }
    if (subcats.agentMessages.tokens > 0) {
      data.push({
        name: 'Agent Messages',
        size: subcats.agentMessages.tokens,
        fill: getCategoryFillColor('messages'),
      });
    }
    if (subcats.toolCalls.tokens > 0) {
      data.push({
        name: 'Tool Calls',
        size: subcats.toolCalls.tokens,
        fill: getCategoryFillColor('messages'),
      });
    }
    if (subcats.toolResults.tokens > 0) {
      data.push({
        name: 'Tool Results',
        size: subcats.toolResults.tokens,
        fill: getCategoryFillColor('messages'),
      });
    }
  }

  const CustomContent = (props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    name?: string;
    value?: number;
  }) => {
    const { x, y, width, height, name, value } = props;

    if (!x || !y || !width || !height || !name || !value) return null;

    // Only show labels if rectangle is large enough
    const showLabel = width > 60 && height > 40;

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          style={{
            stroke: '#fff',
            strokeWidth: 2,
            strokeOpacity: 1,
          }}
        />
        {showLabel && (
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            fill="#fff"
            fontSize={12}
            fontWeight="500"
          >
            <tspan x={x + width / 2} dy="0">
              {name}
            </tspan>
            <tspan x={x + width / 2} dy="16" fontSize={10}>
              {value.toLocaleString()}
            </tspan>
          </text>
        )}
      </g>
    );
  };

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { name: string; value: number }[];
  }) => {
    if (active && payload && payload[0]) {
      const item = payload[0];
      return (
        <div className="bg-base-100 p-3 border border-base-300 rounded-lg shadow-lg">
          <p className="font-medium text-sm">{item.name}</p>
          <p className="text-xs text-base-content/70">{item.value.toLocaleString()} tokens</p>
        </div>
      );
    }
    return null;
  };

  if (data.length === 0) {
    return null;
  }

  const handleTreemapClick = (item: TreemapData) => {
    if (item.category) {
      setSelectedCategory(item.category);
    }
  };

  const getCategoryTitle = () => {
    if (!selectedCategory) return 'Visual Breakdown';
    if (selectedCategory === 'coreTools') return 'Core Tools Breakdown';
    if (selectedCategory === 'mcpTools') return 'MCP Tools Breakdown';
    if (selectedCategory === 'messages') return 'Messages Breakdown';
    return 'Visual Breakdown';
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        {selectedCategory && (
          <button
            onClick={() => setSelectedCategory(null)}
            className="btn btn-xs btn-ghost gap-1"
            title="Back to overview"
          >
            <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
          </button>
        )}
        <div className="text-sm font-medium">{getCategoryTitle()}</div>
      </div>
      <div className="rounded-lg border border-base-300 overflow-hidden cursor-pointer">
        <ResponsiveContainer width="100%" height={300}>
          <Treemap
            data={data}
            dataKey="size"
            stroke="#fff"
            fill="#8884d8"
            isAnimationActive={false}
            onClick={(item: unknown) => handleTreemapClick(item as TreemapData)}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
