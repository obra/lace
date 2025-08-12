// ABOUTME: Storybook stories for DirectoryField component
// ABOUTME: Documents all component variants with interactive examples

import type { Meta, StoryObj } from '@storybook/react';
import { DirectoryField } from './DirectoryField';
import { useState } from 'react';

const meta = {
  title: 'UI/DirectoryField',
  component: DirectoryField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'A directory browser field that allows users to select directories by typing or browsing. Includes autocomplete and navigation features.',
      },
    },
  },
  argTypes: {
    onChange: { action: 'changed' },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DirectoryField>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper component to manage state
function DirectoryFieldWrapper(props: Partial<React.ComponentProps<typeof DirectoryField>>) {
  const [value, setValue] = useState(props.value || '');
  
  return (
    <DirectoryField
      {...props}
      value={value}
      onChange={setValue}
    />
  );
}

export const Default: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Project Directory',
    placeholder: 'Select a directory',
  },
};

export const Required: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Required Directory',
    required: true,
    helpText: 'This field is required',
  },
};

export const WithError: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Directory with Error',
    error: true,
    value: '/invalid/path',
    helpText: 'Please select a valid directory',
  },
};

export const Disabled: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Disabled Directory',
    value: '/some/path',
    disabled: true,
  },
};

export const WithValue: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Pre-filled Directory',
    value: process.env.HOME || '/home/user',
    helpText: 'Directory field with existing value',
  },
};

export const LargeSize: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Large Directory Field',
    placeholder: 'Choose your project directory',
    className: 'input-lg',
    helpText: 'Large input for prominent form sections',
  },
};

export const WithoutLabel: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    placeholder: 'Select directory path',
    helpText: 'Directory field without label',
  },
};