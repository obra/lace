/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for VaporBackground.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { VaporBackground } from './VaporBackground';

const meta: Meta<typeof VaporBackground> = {
  title: 'Atoms/VaporBackground',
  component: VaporBackground,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof VaporBackground>;

export const Normal: Story = {
  render: () => (
    <div data-theme="dim" className="relative min-h-screen">
      <VaporBackground />
      <div className="relative flex items-center justify-center min-h-screen">
        <div className="text-base-content/80">Vapor background (normal)</div>
      </div>
    </div>
  ),
};

export const Soft: Story = {
  render: () => (
    <div data-theme="dim" className="relative min-h-screen">
      <VaporBackground intensity="soft" />
      <div className="relative flex items-center justify-center min-h-screen">
        <div className="text-base-content/80">Vapor background (soft)</div>
      </div>
    </div>
  ),
};
