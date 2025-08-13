// ABOUTME: Storybook story for ChatInterface.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import ChatInterface from './ChatInterface';

const meta: Meta<typeof ChatInterface> = {
  title: 'Pages/ChatInterface',
  component: ChatInterface,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Chat interface page wrapper that provides the main Lace application interface. This is a simple wrapper around the LaceApp component for routing purposes.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ChatInterface>;

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Default chat interface showing the complete Lace application with sidebar, timeline, and chat input.',
      },
    },
  },
};