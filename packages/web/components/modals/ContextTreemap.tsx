// ABOUTME: Treemap visualization of context token usage
// ABOUTME: Shows proportional rectangles for each category with interactive tooltips

'use client';

import React from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { ContextBreakdown } from '@/types/context';

interface TreemapData {
  name: string;
  size: number;
  fill: string;
  [key: string]: string | number;
}

interface ContextTreemapProps {
  breakdown: ContextBreakdown;
}

export function ContextTreemap({ breakdown }: ContextTreemapProps) {
  // Transform breakdown into recharts treemap format
  const data: TreemapData[] = [];

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

  if (breakdown.categories.systemPrompt.tokens > 0) {
    data.push({
      name: 'System Prompt',
      size: breakdown.categories.systemPrompt.tokens,
      fill: getCategoryFillColor('systemPrompt'),
    });
  }

  if (breakdown.categories.coreTools.tokens > 0) {
    data.push({
      name: 'Core Tools',
      size: breakdown.categories.coreTools.tokens,
      fill: getCategoryFillColor('coreTools'),
    });
  }

  if (breakdown.categories.mcpTools.tokens > 0) {
    data.push({
      name: 'MCP Tools',
      size: breakdown.categories.mcpTools.tokens,
      fill: getCategoryFillColor('mcpTools'),
    });
  }

  if (breakdown.categories.messages.tokens > 0) {
    data.push({
      name: 'Messages',
      size: breakdown.categories.messages.tokens,
      fill: getCategoryFillColor('messages'),
    });
  }

  if (breakdown.categories.reservedForResponse.tokens > 0) {
    data.push({
      name: 'Reserved',
      size: breakdown.categories.reservedForResponse.tokens,
      fill: getCategoryFillColor('reservedForResponse'),
    });
  }

  if (breakdown.categories.freeSpace.tokens > 0) {
    data.push({
      name: 'Free Space',
      size: breakdown.categories.freeSpace.tokens,
      fill: getCategoryFillColor('freeSpace'),
    });
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

  return (
    <div className="mb-6">
      <div className="text-sm font-medium mb-2">Visual Breakdown</div>
      <div className="rounded-lg border border-base-300 overflow-hidden">
        <ResponsiveContainer width="100%" height={300}>
          <Treemap
            data={data}
            dataKey="size"
            stroke="#fff"
            fill="#8884d8"
            isAnimationActive={false}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
