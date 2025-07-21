import type { Meta, StoryObj } from '@storybook/react';
import TimestampDisplay from './TimestampDisplay';

const meta: Meta<typeof TimestampDisplay> = {
  title: 'Atoms/TimestampDisplay',
  component: TimestampDisplay,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'TimestampDisplay component for showing formatted timestamps in different formats and sizes.',
      },
    },
  },
  argTypes: {
    timestamp: {
      control: { type: 'date' },
      description: 'The timestamp to display (Date object or string)',
    },
    format: {
      control: { type: 'select' },
      options: ['time', 'relative', 'full'],
      description: 'Format type for the timestamp',
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md'],
      description: 'Text size of the timestamp',
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

// Sample timestamps for demonstrations
const now = new Date();
const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

export const TimeFormat: Story = {
  args: {
    timestamp: now,
    format: 'time',
    size: 'xs',
  },
};

export const RelativeFormat: Story = {
  args: {
    timestamp: fiveMinutesAgo,
    format: 'relative',
    size: 'xs',
  },
};

export const FullFormat: Story = {
  args: {
    timestamp: now,
    format: 'full',
    size: 'xs',
  },
};

export const SmallSize: Story = {
  args: {
    timestamp: now,
    format: 'time',
    size: 'sm',
  },
};

export const MediumSize: Story = {
  args: {
    timestamp: now,
    format: 'time',
    size: 'md',
  },
};

export const AllFormats: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <TimestampDisplay timestamp={now} format="time" size="sm" />
        <p className="text-xs text-gray-500 mt-1">Time Format</p>
      </div>
      <div className="text-center">
        <TimestampDisplay timestamp={fiveMinutesAgo} format="relative" size="sm" />
        <p className="text-xs text-gray-500 mt-1">Relative Format</p>
      </div>
      <div className="text-center">
        <TimestampDisplay timestamp={now} format="full" size="sm" />
        <p className="text-xs text-gray-500 mt-1">Full Format</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available timestamp formats displayed together.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <TimestampDisplay timestamp={now} format="time" size="xs" />
        <p className="text-xs text-gray-500 mt-1">XS</p>
      </div>
      <div className="text-center">
        <TimestampDisplay timestamp={now} format="time" size="sm" />
        <p className="text-xs text-gray-500 mt-1">SM</p>
      </div>
      <div className="text-center">
        <TimestampDisplay timestamp={now} format="time" size="md" />
        <p className="text-xs text-gray-500 mt-1">MD</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available timestamp sizes displayed together.',
      },
    },
  },
};

export const RelativeTimeExamples: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">Just now:</span>
        <TimestampDisplay timestamp={now} format="relative" size="sm" />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">5 minutes ago:</span>
        <TimestampDisplay timestamp={fiveMinutesAgo} format="relative" size="sm" />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">1 hour ago:</span>
        <TimestampDisplay timestamp={oneHourAgo} format="relative" size="sm" />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">1 day ago:</span>
        <TimestampDisplay timestamp={oneDayAgo} format="relative" size="sm" />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">1 week ago:</span>
        <TimestampDisplay timestamp={oneWeekAgo} format="relative" size="sm" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Examples of relative time formatting for different time periods.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Timestamp Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the timestamps below!
        </p>
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <div className="text-lg font-semibold">Current Time</div>
          <TimestampDisplay timestamp={now} format="full" size="md" />
          <p className="text-xs text-gray-500 mt-2">Full format display</p>
        </div>
        
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <div className="text-lg font-semibold">5 Minutes Ago</div>
          <TimestampDisplay timestamp={fiveMinutesAgo} format="relative" size="md" />
          <p className="text-xs text-gray-500 mt-2">Relative format display</p>
        </div>
        
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <div className="text-lg font-semibold">1 Hour Ago</div>
          <TimestampDisplay timestamp={oneHourAgo} format="relative" size="md" />
          <p className="text-xs text-gray-500 mt-2">Relative format display</p>
        </div>
        
        <div className="text-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
          <div className="text-lg font-semibold">1 Day Ago</div>
          <TimestampDisplay timestamp={oneDayAgo} format="relative" size="md" />
          <p className="text-xs text-gray-500 mt-2">Relative format display</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing timestamp displays with tennis commentary. Enable commentary in the toolbar and interact with the timestamps!',
      },
    },
  },
};