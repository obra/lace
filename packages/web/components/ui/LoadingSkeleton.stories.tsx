import type { Meta, StoryObj } from '@storybook/react';
import React, { useState, useEffect } from 'react';
import { LoadingSkeleton, ChatMessageSkeleton, TimelineSkeleton, CarouselSkeleton, CardGridSkeleton } from './LoadingSkeleton';

const meta: Meta<typeof LoadingSkeleton> = {
  title: 'Atoms/LoadingSkeleton',
  component: LoadingSkeleton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## LoadingSkeleton

**Atomic Classification**: Feedback Atom  
**Source**: Core UI primitive for loading states  
**Single Responsibility**: Provide animated loading placeholders for content

### Purpose
A fundamental feedback atom that provides animated skeleton placeholders during loading states. Uses Framer Motion animations to create smooth shimmer effects that indicate content is being loaded, improving perceived performance and user experience.

### When to Use
- Initial page loads
- Data fetching states
- Image loading placeholders
- Content streaming states
- Form submission feedback
- Chat message loading
- Timeline content loading

### Design Tokens Used
- **Colors**: Base-300, base-200 for gradient shimmer effects
- **Spacing**: Consistent spacing for different content types
- **Borders**: Rounded corners matching content styling
- **Animations**: Framer Motion shimmer and stagger effects
- **Layout**: Flexbox and grid layouts for different variants

### Features
- **Multiple Variants**: Text, card, avatar, timeline, carousel skeletons
- **Shimmer Animation**: Smooth gradient animation with Framer Motion
- **Staggered Loading**: Sequential appearance of multiple items
- **Responsive Design**: Adapts to different screen sizes
- **Performance**: Optimized animations with spring configurations
- **Accessibility**: Proper loading indicators for screen readers

### Variants
- **text**: Simple text line skeleton
- **card**: Card-like content skeleton with title and text
- **avatar**: User profile skeleton with avatar and text
- **timeline**: Timeline-style skeleton with multiple items
- **carousel**: Horizontal carousel skeleton with multiple cards

### Animation System
- **Shimmer Effect**: Gradient animation from left to right
- **Stagger Container**: Parent container for sequential animations
- **Stagger Item**: Individual items with delayed animations
- **Spring Config**: Smooth spring-based transitions

### Specialized Components
- **ChatMessageSkeleton**: Pre-configured for chat messages
- **TimelineSkeleton**: Pre-configured for timeline content
- **CarouselSkeleton**: Pre-configured for carousel layouts
- **CardGridSkeleton**: Pre-configured for card grids

### Accessibility
- Visual loading indicators
- Screen reader friendly structure
- Proper contrast ratios
- Animation respects user preferences
- Semantic HTML structure

### Atom Guidelines
✓ **Do**: Use during actual loading states  
✓ **Do**: Match skeleton structure to final content  
✓ **Do**: Use appropriate variant for content type  
✓ **Do**: Combine with actual loading logic  
✗ **Don't**: Use as permanent content  
✗ **Don't**: Override animation timings  
✗ **Don't**: Use for non-loading states
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['text', 'card', 'avatar', 'timeline', 'carousel'],
      description: 'The skeleton variant to display',
    },
    count: {
      control: { type: 'number', min: 1, max: 10 },
      description: 'Number of skeleton items to display',
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
  args: {
    variant: 'text',
    count: 1,
  },
};

export const TextSkeleton: Story = {
  args: {
    variant: 'text',
    count: 1,
  },
};

export const CardSkeleton: Story = {
  args: {
    variant: 'card',
    count: 1,
  },
};

export const AvatarSkeleton: Story = {
  args: {
    variant: 'avatar',
    count: 1,
  },
};

export const TimelineSkeletonStory: Story = {
  args: {
    variant: 'timeline',
    count: 1,
  },
};

export const CarouselSkeletonStory: Story = {
  args: {
    variant: 'carousel',
    count: 1,
  },
};

export const MultipleItems: Story = {
  render: () => (
    <div className="space-y-8 w-full max-w-2xl">
      <div>
        <h4 className="font-medium mb-3">Multiple Text Lines</h4>
        <LoadingSkeleton variant="text" count={3} />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Multiple Cards</h4>
        <LoadingSkeleton variant="card" count={2} />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Multiple Avatars</h4>
        <LoadingSkeleton variant="avatar" count={3} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Examples of multiple skeleton items with staggered animations.',
      },
    },
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-8 w-full max-w-4xl">
      <div>
        <h4 className="font-medium mb-3">Text Skeleton</h4>
        <LoadingSkeleton variant="text" />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Card Skeleton</h4>
        <LoadingSkeleton variant="card" />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Avatar Skeleton</h4>
        <LoadingSkeleton variant="avatar" />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Timeline Skeleton</h4>
        <LoadingSkeleton variant="timeline" />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Carousel Skeleton</h4>
        <LoadingSkeleton variant="carousel" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available skeleton variants showcased together.',
      },
    },
  },
};

export const SpecializedComponents: Story = {
  render: () => (
    <div className="space-y-8 w-full max-w-4xl">
      <div>
        <h4 className="font-medium mb-3">Chat Message Skeleton</h4>
        <div className="space-y-4">
          <ChatMessageSkeleton />
          <ChatMessageSkeleton />
          <ChatMessageSkeleton />
        </div>
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Timeline Skeleton</h4>
        <TimelineSkeleton />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Carousel Skeleton</h4>
        <CarouselSkeleton />
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Card Grid Skeleton</h4>
        <CardGridSkeleton count={3} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Pre-configured specialized skeleton components for common use cases.',
      },
    },
  },
};

export const LoadingSimulation: Story = {
  render: () => {
    const [isLoading, setIsLoading] = React.useState(true);
    
    React.useEffect(() => {
      const timer = setTimeout(() => {
        setIsLoading(false);
      }, 3000);
      
      return () => clearTimeout(timer);
    }, []);
    
    const handleReload = () => {
      setIsLoading(true);
      setTimeout(() => setIsLoading(false), 3000);
    };
    
    return (
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Loading Simulation</h4>
          <button 
            onClick={handleReload}
            className="btn btn-sm btn-primary"
          >
            Reload
          </button>
        </div>
        
        {isLoading ? (
          <div className="space-y-4">
            <ChatMessageSkeleton />
            <ChatMessageSkeleton />
            <ChatMessageSkeleton />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary text-primary-content rounded-md flex items-center justify-center text-sm font-medium">
                AI
              </div>
              <div>
                <div className="font-medium">AI Assistant</div>
                <div className="text-sm text-gray-600">Just now</div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-secondary text-secondary-content rounded-md flex items-center justify-center text-sm font-medium">
                U
              </div>
              <div>
                <div className="font-medium">User</div>
                <div className="text-sm text-gray-600">2 minutes ago</div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-accent text-accent-content rounded-md flex items-center justify-center text-sm font-medium">
                AI
              </div>
              <div>
                <div className="font-medium">AI Assistant</div>
                <div className="text-sm text-gray-600">5 minutes ago</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Simulation of loading state transitioning to actual content.',
      },
    },
  },
};

export const ResponsiveExample: Story = {
  render: () => (
    <div className="w-full space-y-6">
      <div>
        <h4 className="font-medium mb-3">Mobile Layout</h4>
        <div className="max-w-sm">
          <LoadingSkeleton variant="card" count={2} />
        </div>
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Desktop Layout</h4>
        <div className="max-w-4xl">
          <LoadingSkeleton variant="carousel" />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Responsive skeleton layouts for different screen sizes.',
      },
    },
  },
};

export const CustomSizes: Story = {
  render: () => (
    <div className="space-y-6 w-full max-w-4xl">
      <div>
        <h4 className="font-medium mb-3">Custom Width Text</h4>
        <div className="space-y-2">
          <LoadingSkeleton variant="text" className="w-full" />
          <LoadingSkeleton variant="text" className="w-3/4" />
          <LoadingSkeleton variant="text" className="w-1/2" />
          <LoadingSkeleton variant="text" className="w-1/4" />
        </div>
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Custom Height Text</h4>
        <div className="space-y-2">
          <LoadingSkeleton variant="text" className="h-3" />
          <LoadingSkeleton variant="text" className="h-4" />
          <LoadingSkeleton variant="text" className="h-6" />
          <LoadingSkeleton variant="text" className="h-8" />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Custom sizing examples for different content types.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 LoadingSkeleton Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover over the loading skeletons below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Chat Loading</h4>
          <div className="space-y-3">
            <ChatMessageSkeleton />
            <ChatMessageSkeleton />
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Card Loading</h4>
          <LoadingSkeleton variant="card" />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Timeline Loading</h4>
          <LoadingSkeleton variant="timeline" />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Carousel Loading</h4>
          <LoadingSkeleton variant="carousel" />
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Loading Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Shimmer Animation</strong> - Smooth gradient animation indicates loading</li>
          <li>• <strong>Staggered Appearance</strong> - Sequential loading of multiple items</li>
          <li>• <strong>Multiple Variants</strong> - Different skeleton types for various content</li>
          <li>• <strong>Responsive Design</strong> - Adapts to different screen sizes</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing loading skeletons with tennis commentary. Enable commentary in the toolbar and hover over the skeletons!',
      },
    },
  },
};