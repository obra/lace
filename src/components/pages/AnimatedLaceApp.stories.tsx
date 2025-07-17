import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedLaceApp } from './AnimatedLaceApp';

const meta: Meta<typeof AnimatedLaceApp> = {
  title: 'Pages/AnimatedLaceApp',
  component: AnimatedLaceApp,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Enhanced animated version of the main Lace application with Framer Motion animations, smooth transitions, and interactive elements. Features animated timeline view, voice recognition, task management, and comprehensive UI animations.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnimatedLaceApp>;

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Default animated Lace application with enhanced animations, transitions, and interactive features. Includes animated timeline, voice recognition, and task management.',
      },
    },
  },
};

export const MobileView: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Animated Lace application optimized for mobile devices with mobile sidebar, touch interactions, and responsive animations.',
      },
    },
  },
};

export const TabletView: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
    docs: {
      description: {
        story: 'Animated Lace application on tablet devices showing responsive layout transitions and touch-optimized interactions.',
      },
    },
  },
};

export const DarkTheme: Story = {
  parameters: {
    backgrounds: {
      default: 'dark',
    },
    docs: {
      description: {
        story: 'Animated Lace application with dark theme showing theme-aware animations and color transitions.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="dark">
        <Story />
      </div>
    ),
  ],
};

export const LightTheme: Story = {
  parameters: {
    backgrounds: {
      default: 'light',
    },
    docs: {
      description: {
        story: 'Animated Lace application with light theme showing bright, clean animations and transitions.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="light">
        <Story />
      </div>
    ),
  ],
};

export const CyberpunkTheme: Story = {
  parameters: {
    backgrounds: {
      default: 'dark',
    },
    docs: {
      description: {
        story: 'Animated Lace application with cyberpunk theme featuring neon colors and futuristic animations.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="cyberpunk">
        <Story />
      </div>
    ),
  ],
};