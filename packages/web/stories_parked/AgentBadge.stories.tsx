// ABOUTME: Storybook story for AgentBadge.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import AgentBadge from './AgentBadge';

const meta: Meta<typeof AgentBadge> = {
  title: 'Atoms/AgentBadge',
  component: AgentBadge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## AgentBadge

**Atomic Classification**: Identity Atom  
**Source**: Extracted from conversation interfaces  
**Single Responsibility**: Display agent identification with consistent styling

### Purpose
A foundational atom that provides visual identification for AI agents in conversation interfaces. Uses agent-specific colors and typography to maintain consistent branding across different contexts.

### When to Use
- Message headers to identify the AI agent
- Conversation lists to show agent type
- Settings to display current agent selection
- Timeline entries for agent identification

### Design Tokens Used
- **Colors**: Agent-specific color schemes (orange for Claude, blue for GPT-4, purple for Gemini)
- **Typography**: Consistent font sizing and weight hierarchy
- **Spacing**: Proportional padding for different sizes
- **Borders**: Rounded corners for modern appearance

### Size Scale
- **Extra Small (xs)**: 10px text - Minimal contexts
- **Small (sm)**: 12px text - Compact interfaces
- **Medium (md)**: 14px text - Standard usage

### Agent Support
- **Claude**: Orange theme with proper contrast
- **GPT-4**: Blue theme with OpenAI branding
- **Gemini**: Purple theme with Google styling

### Accessibility
- Proper ARIA labels for screen readers
- Sufficient color contrast ratios
- Keyboard navigation support
- High contrast mode compatibility

### Atom Guidelines
✓ **Do**: Use for consistent agent identification  
✓ **Do**: Maintain agent-specific color coding  
✓ **Do**: Follow size scale for hierarchy  
✗ **Don't**: Create custom colors outside the agent system  
✗ **Don't**: Mix with unrelated badge types  
✗ **Don't**: Override semantic meaning
        `,
      },
    },
  },
  argTypes: {
    agent: {
      control: { type: 'select' },
      options: ['Claude', 'GPT-4', 'Gemini'],
      description: 'The agent name to display',
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md'],
      description: 'The size of the badge',
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Claude: Story = {
  args: {
    agent: 'Claude',
    size: 'md',
  },
};

export const GPT4: Story = {
  args: {
    agent: 'GPT-4',
    size: 'md',
  },
};

export const Gemini: Story = {
  args: {
    agent: 'Gemini',
    size: 'md',
  },
};

export const ExtraSmall: Story = {
  args: {
    agent: 'Claude',
    size: 'xs',
  },
};

export const Small: Story = {
  args: {
    agent: 'Claude',
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    agent: 'Claude',
    size: 'md',
  },
};

export const AllAgents: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <AgentBadge agent="Claude" size="md" />
      <AgentBadge agent="GPT-4" size="md" />
      <AgentBadge agent="Gemini" size="md" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available agent badges displayed together.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <AgentBadge agent="Claude" size="xs" />
      <AgentBadge agent="Claude" size="sm" />
      <AgentBadge agent="Claude" size="md" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available badge sizes displayed together.',
      },
    },
  },
};
