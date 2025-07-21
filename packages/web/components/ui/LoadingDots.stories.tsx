import type { Meta, StoryObj } from '@storybook/react';
import LoadingDots from './LoadingDots';

const meta: Meta<typeof LoadingDots> = {
  title: 'Atoms/LoadingDots',
  component: LoadingDots,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'LoadingDots component for displaying animated loading indicators with different sizes.',
      },
    },
  },
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'The size of the loading dots',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ExtraSmall: Story = {
  args: {
    size: 'xs',
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <LoadingDots size="xs" />
        <p className="text-xs text-gray-500 mt-2">XS</p>
      </div>
      <div className="text-center">
        <LoadingDots size="sm" />
        <p className="text-xs text-gray-500 mt-2">SM</p>
      </div>
      <div className="text-center">
        <LoadingDots size="md" />
        <p className="text-xs text-gray-500 mt-2">MD</p>
      </div>
      <div className="text-center">
        <LoadingDots size="lg" />
        <p className="text-xs text-gray-500 mt-2">LG</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available loading dot sizes displayed together.',
      },
    },
  },
};

export const InContext: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 p-4 bg-base-200 rounded-lg">
        <LoadingDots size="sm" />
        <span className="text-sm">Processing your request...</span>
      </div>
      
      <div className="flex items-center gap-2 p-4 bg-base-200 rounded-lg">
        <LoadingDots size="md" />
        <span className="text-base">Generating response...</span>
      </div>
      
      <div className="flex items-center gap-2 p-4 bg-base-200 rounded-lg">
        <LoadingDots size="lg" />
        <span className="text-lg">Loading conversation...</span>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Loading dots used in different contexts with text.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Loading Dots Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the loading indicators below!
        </p>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <LoadingDots size="lg" />
          <p className="text-sm font-medium mt-2">Processing</p>
          <p className="text-xs text-gray-500">Large loading dots</p>
        </div>
        
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <LoadingDots size="md" />
          <p className="text-sm font-medium mt-2">Thinking</p>
          <p className="text-xs text-gray-500">Medium loading dots</p>
        </div>
        
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <LoadingDots size="sm" />
          <p className="text-sm font-medium mt-2">Loading</p>
          <p className="text-xs text-gray-500">Small loading dots</p>
        </div>
        
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <LoadingDots size="xs" />
          <p className="text-sm font-medium mt-2">Saving</p>
          <p className="text-xs text-gray-500">Extra small dots</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing loading dots with tennis commentary. Enable commentary in the toolbar and interact with the loading indicators!',
      },
    },
  },
};