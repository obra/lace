/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for GlassCard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { GlassCard } from './GlassCard';
import { VaporBackground } from './VaporBackground';

const meta: Meta<typeof GlassCard> = {
  title: 'Atoms/GlassCard',
  component: GlassCard,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div data-theme="dim" className="relative min-h-screen w-screen p-8">
        <VaporBackground intensity="soft" />
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof GlassCard>;

export const Default: Story = {
  args: {
    className: 'max-w-xl',
    children: (
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">Glass card</h3>
        <p className="text-base-content/70">A dim-theme friendly glass surface.</p>
      </div>
    ),
  },
};
