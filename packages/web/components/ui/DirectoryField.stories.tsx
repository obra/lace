// ABOUTME: Storybook stories for DirectoryField component
// ABOUTME: Documents all component variants with interactive examples

import type { Meta, StoryObj } from '@storybook/react';
import { DirectoryField } from './DirectoryField';
import { useState } from 'react';

// Create a meta object that doesn't enforce the DirectoryField component's required props
const meta: Meta = {
  title: 'UI/DirectoryField',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'A directory browser field that allows users to select directories by typing or browsing. Includes autocomplete and navigation features.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// Wrapper component to manage state
function DirectoryFieldWrapper(props: Omit<React.ComponentProps<typeof DirectoryField>, 'value' | 'onChange'> & { value?: string }) {
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
  render: () => <DirectoryFieldWrapper 
    label="Project Directory"
    placeholder="Select a directory"
  />,
};

export const Required: Story = {
  render: () => <DirectoryFieldWrapper 
    label="Required Directory"
    required={true}
    helpText="This field is required"
  />,
};

export const WithError: Story = {
  render: () => <DirectoryFieldWrapper 
    label="Directory with Error"
    error={true}
    value="/invalid/path"
    helpText="Please select a valid directory"
  />,
};

export const Disabled: Story = {
  render: () => <DirectoryFieldWrapper 
    label="Disabled Directory"
    value="/some/path"
    disabled={true}
  />,
};

export const WithValue: Story = {
  render: () => <DirectoryFieldWrapper 
    label="Pre-filled Directory"
    value={'/home/user'}
    helpText="Directory field with existing value"
  />,
};

export const LargeSize: Story = {
  render: () => <DirectoryFieldWrapper 
    label="Large Directory Field"
    placeholder="Choose your project directory"
    className="input-lg"
    helpText="Large input for prominent form sections"
  />,
};

export const WithoutLabel: Story = {
  render: () => <DirectoryFieldWrapper 
    placeholder="Select directory path"
    helpText="Directory field without label"
  />,
};