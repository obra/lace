// ABOUTME: Storybook story for SkeletonLoader.stories.tsx
import type { Meta, StoryObj, StoryContext } from '@storybook/react';
import React, { useState, useEffect } from 'react';
import SkeletonLoader, { DocumentSkeleton } from './SkeletonLoader';

const meta: Meta<typeof SkeletonLoader> = {
  title: 'Molecules/SkeletonLoader',
  component: SkeletonLoader,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## SkeletonLoader

**Atomic Classification**: Loading Molecule  
**Composed of**: Container + AnimationProvider + StatusDot + MessageText atoms  
**Single Responsibility**: Loading state visualization with animated placeholders for content

### Purpose
A cohesive molecule that combines 3-4 atoms to solve the specific UI pattern of loading states. Handles content placeholders, animation timing, size variations, and loading feedback in a single, reusable component.

### When to Use
- Content loading states
- Data fetching placeholders
- Progressive loading interfaces
- Skeleton screens for better UX
- Loading states for images and text

### Atomic Composition
- **Container**: Structured layout with proper sizing and positioning
- **AnimationProvider**: Pulse animation for loading feedback
- **StatusDot**: Visual indicators for loading states
- **MessageText**: ARIA labels for screen reader accessibility
- **Background Elements**: Styled backgrounds for content simulation

### Design Tokens Used
- **Colors**: Base-300 background color for neutral placeholder appearance
- **Animations**: Pulse animation for loading feedback
- **Spacing**: Configurable width and height for content matching
- **Typography**: Proper sizing for text placeholder simulation
- **Borders**: Rounded corners matching content appearance
- **Opacity**: Subtle opacity changes for animation effects

### Loading States
- **loading**: Active pulsing animation indicating content is loading
- **ready**: Static state when content is about to appear
- **error**: Error state for failed loading operations
- **complete**: Transition state before content replacement

### State Management
- **width**: Configurable width for content matching
- **height**: Configurable height for content matching
- **rounded**: Border radius variants for different content types
- **className**: Additional styling for specific use cases

### Accessibility
- Proper ARIA attributes (role="status", aria-label="Loading...")
- Screen reader announcements for loading states
- Reduced motion support for animation preferences
- High contrast mode compatibility
- Semantic HTML structure for assistive technologies

### Composition Guidelines
✓ **Do**: Use in loading organisms and skeleton templates  
✓ **Do**: Combine atoms logically for loading states  
✓ **Do**: Maintain single responsibility for loading feedback  
✓ **Do**: Match content dimensions for smooth transitions  
✗ **Don't**: Mix unrelated loading functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create complex nested loading structures
        `,
      },
    },
  },
  argTypes: {
    width: {
      control: { type: 'text' },
      description: 'Width class (e.g., "w-full", "w-32")',
    },
    height: {
      control: { type: 'text' },
      description: 'Height class (e.g., "h-4", "h-8")',
    },
    rounded: {
      control: { type: 'select' },
      options: ['none', 'sm', 'md', 'lg', 'full'],
      description: 'Border radius variant',
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

export const Default: Story = {
  args: {},
};

export const Small: Story = {
  args: {
    width: 'w-32',
    height: 'h-3',
  },
};

export const Large: Story = {
  args: {
    width: 'w-96',
    height: 'h-6',
  },
};

export const Rounded: Story = {
  args: {
    rounded: 'full',
    width: 'w-16',
    height: 'h-16',
  },
};

export const TextSkeletons: Story = {
  render: () => (
    <div className="w-full max-w-md space-y-3">
      <div className="text-center text-sm font-medium text-base-content/60 mb-4">
        Text Loading Skeletons
      </div>

      {/* Heading skeleton */}
      <SkeletonLoader width="w-48" height="h-6" rounded="md" />

      {/* Paragraph skeletons */}
      <div className="space-y-2">
        <SkeletonLoader width="w-full" height="h-4" />
        <SkeletonLoader width="w-5/6" height="h-4" />
        <SkeletonLoader width="w-4/5" height="h-4" />
      </div>

      {/* Button skeleton */}
      <SkeletonLoader width="w-24" height="h-8" rounded="md" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Various skeleton loaders for text content of different sizes.',
      },
    },
  },
};

export const CardSkeletons: Story = {
  render: () => (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center text-sm font-medium text-base-content/60 mb-4">
        Card Loading Skeletons
      </div>

      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="bg-base-100 border border-base-300 rounded-lg p-4 space-y-3">
          {/* Avatar and title */}
          <div className="flex items-center gap-3">
            <SkeletonLoader width="w-10" height="h-10" rounded="full" />
            <div className="flex-1 space-y-1">
              <SkeletonLoader width="w-24" height="h-4" />
              <SkeletonLoader width="w-16" height="h-3" />
            </div>
          </div>

          {/* Content */}
          <div className="space-y-2">
            <SkeletonLoader width="w-full" height="h-3" />
            <SkeletonLoader width="w-4/5" height="h-3" />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <SkeletonLoader width="w-16" height="h-6" rounded="full" />
            <SkeletonLoader width="w-12" height="h-6" rounded="full" />
          </div>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Card-based skeleton loaders for list items and feed content.',
      },
    },
  },
};

export const DocumentSkeletonDemo: Story = {
  render: () => (
    <div className="w-full max-w-md">
      <div className="text-center text-sm font-medium text-base-content/60 mb-4">
        Document Loading Skeleton
      </div>

      <div className="bg-base-100 border border-base-300 rounded-lg p-4">
        <DocumentSkeleton />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Specialized document skeleton loader for file previews.',
      },
    },
  },
};

export const LoadingSimulation: Story = {
  render: () => {
    const [isLoading, setIsLoading] = useState(true);
    const [content, setContent] = useState<{
      title: string;
      description: string;
      author: string;
      date: string;
    } | null>(null);

    useEffect(() => {
      const timer = setTimeout(() => {
        setIsLoading(false);
        setContent({
          title: 'Real Content Loaded',
          description: 'This is the actual content that replaced the skeleton loader.',
          author: 'John Doe',
          date: '2 hours ago',
        });
      }, 3000);

      return () => clearTimeout(timer);
    }, []);

    const handleReload = () => {
      setIsLoading(true);
      setContent(null);
      setTimeout(() => {
        setIsLoading(false);
        setContent({
          title: 'Real Content Loaded',
          description: 'This is the actual content that replaced the skeleton loader.',
          author: 'John Doe',
          date: '2 hours ago',
        });
      }, 3000);
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <button onClick={handleReload} className="btn btn-primary btn-sm">
            Reload Content
          </button>
        </div>

        <div className="bg-base-100 border border-base-300 rounded-lg p-4">
          {isLoading ? (
            <div className="space-y-3">
              {/* Header skeleton */}
              <div className="flex items-center gap-3">
                <SkeletonLoader width="w-10" height="h-10" rounded="full" />
                <div className="flex-1 space-y-1">
                  <SkeletonLoader width="w-32" height="h-4" />
                  <SkeletonLoader width="w-20" height="h-3" />
                </div>
              </div>

              {/* Content skeleton */}
              <div className="space-y-2">
                <SkeletonLoader width="w-full" height="h-4" />
                <SkeletonLoader width="w-5/6" height="h-4" />
                <SkeletonLoader width="w-4/5" height="h-4" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Real content */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                  <span className="text-primary">👤</span>
                </div>
                <div>
                  <div className="font-medium text-sm">{content?.author}</div>
                  <div className="text-xs text-base-content/60">{content?.date}</div>
                </div>
              </div>

              <div>
                <h3 className="font-medium text-base-content mb-1">{content?.title}</h3>
                <p className="text-sm text-base-content/80">{content?.description}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Realistic loading simulation showing skeleton to content transition.',
      },
    },
  },
};

export const ResponsiveSkeletons: Story = {
  render: () => (
    <div className="w-full max-w-2xl space-y-6">
      <div className="text-center text-sm font-medium text-base-content/60 mb-4">
        Responsive Skeleton Layout
      </div>

      {/* Desktop layout */}
      <div className="hidden md:block">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="bg-base-100 border border-base-300 rounded-lg p-3 space-y-2"
            >
              <SkeletonLoader width="w-full" height="h-32" rounded="md" />
              <SkeletonLoader width="w-full" height="h-4" />
              <SkeletonLoader width="w-2/3" height="h-3" />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile layout */}
      <div className="md:hidden">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="bg-base-100 border border-base-300 rounded-lg p-4 space-y-3"
            >
              <div className="flex gap-3">
                <SkeletonLoader width="w-16" height="h-16" rounded="md" />
                <div className="flex-1 space-y-2">
                  <SkeletonLoader width="w-full" height="h-4" />
                  <SkeletonLoader width="w-3/4" height="h-3" />
                  <SkeletonLoader width="w-1/2" height="h-3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Responsive skeleton layouts that adapt to different screen sizes.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Skeleton Loader Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then interact with the loading states!
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer">
          {LoadingSimulation.render ? (
            LoadingSimulation.render(LoadingSimulation.args || {}, {} as StoryContext)
          ) : (
            <div>Loading Simulation</div>
          )}
        </div>

        <div className="cursor-pointer">
          {DocumentSkeletonDemo.render ? (
            DocumentSkeletonDemo.render(DocumentSkeletonDemo.args || {}, {} as StoryContext)
          ) : (
            <div>Document Skeleton Demo</div>
          )}
        </div>
      </div>

      <div className="cursor-pointer">
        {CardSkeletons.render ? (
          CardSkeletons.render(CardSkeletons.args || {}, {} as StoryContext)
        ) : (
          <div>Card Skeletons</div>
        )}
      </div>

      <div className="text-sm text-gray-600 space-y-1">
        <p>
          • <strong>Click reload</strong> to see loading simulation
        </p>
        <p>
          • <strong>Watch transitions</strong> from skeleton to content
        </p>
        <p>
          • <strong>Notice animations</strong> in the loading states
        </p>
        <p>
          • <strong>Hover elements</strong> for tennis commentary feedback!
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing skeleton loaders with tennis commentary. Enable commentary in the toolbar and interact with the loading states!',
      },
    },
  },
};
