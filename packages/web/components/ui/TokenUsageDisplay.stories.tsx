// ABOUTME: Storybook story for TokenUsageDisplay.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import TokenUsageDisplay, { type TokenUsageData } from '@/components/ui/TokenUsageDisplay';

const meta = {
  title: 'UI/TokenUsageDisplay',
  component: TokenUsageDisplay,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TokenUsageDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sample token usage data for stories
const lowUsageData: TokenUsageData = {
  totalPromptTokens: 1200,
  totalCompletionTokens: 800,
  totalTokens: 2000,
  contextLimit: 128000,
  percentUsed: 1.6,
  nearLimit: false,
};

const moderateUsageData: TokenUsageData = {
  totalPromptTokens: 32000,
  totalCompletionTokens: 18000,
  totalTokens: 50000,
  contextLimit: 128000,
  percentUsed: 39.1,
  nearLimit: false,
};

const highUsageData: TokenUsageData = {
  totalPromptTokens: 78000,
  totalCompletionTokens: 22000,
  totalTokens: 100000,
  contextLimit: 128000,
  percentUsed: 78.1,
  nearLimit: true,
};

const criticalUsageData: TokenUsageData = {
  totalPromptTokens: 98000,
  totalCompletionTokens: 17000,
  totalTokens: 115000,
  contextLimit: 128000,
  percentUsed: 89.8,
  nearLimit: true,
};

const largeScaleUsageData: TokenUsageData = {
  totalPromptTokens: 1200000,
  totalCompletionTokens: 800000,
  totalTokens: 2000000,
  contextLimit: 2000000,
  percentUsed: 100.0,
  nearLimit: true,
};

export const Loading: Story = {
  args: {
    tokenUsage: null,
    loading: true,
  },
};

export const LowUsage: Story = {
  args: {
    tokenUsage: lowUsageData,
  },
};

export const ModerateUsage: Story = {
  args: {
    tokenUsage: moderateUsageData,
  },
};

export const HighUsage: Story = {
  args: {
    tokenUsage: highUsageData,
  },
};

export const CriticalUsage: Story = {
  args: {
    tokenUsage: criticalUsageData,
  },
};

export const LargeScale: Story = {
  args: {
    tokenUsage: largeScaleUsageData,
  },
};

export const NoData: Story = {
  args: {
    tokenUsage: null,
    loading: false,
  },
};
