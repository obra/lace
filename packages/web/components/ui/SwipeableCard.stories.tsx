import type { Meta, StoryObj, StoryContext } from '@storybook/react';
import React, { useState } from 'react';
import { SwipeableCard, SwipeableTimelineMessage, PullToRefresh, FloatingActionButton, LongPress } from './SwipeableCard';

const meta: Meta<typeof SwipeableCard> = {
  title: 'Molecules/SwipeableCard',
  component: SwipeableCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## SwipeableCard

**Atomic Classification**: Gesture Molecule  
**Composed of**: Container + IconButton + MessageText + StatusDot + Animation atoms  
**Single Responsibility**: Touch-based swipe gesture interface with action feedback and animation

### Purpose
A cohesive molecule that combines 4-5 atoms to solve the specific UI pattern of swipe-based interactions. Handles touch gestures, visual feedback, action triggers, and smooth animations in a single, gesture-enabled component.

### When to Use
- Mobile-first interfaces
- Timeline message interactions
- List item actions (delete, archive, star)
- Card-based navigation
- Touch-enabled dashboards

### Atomic Composition
- **Container**: Structured layout with proper positioning and overflow handling
- **IconButton**: Action icons with proper sizing and colors
- **MessageText**: Action labels and feedback text
- **StatusDot**: Visual indicators for action states
- **Animation**: Framer Motion components for smooth gesture animations
- **Background Elements**: Colored backgrounds for action feedback

### Design Tokens Used
- **Colors**: Semantic colors for actions (red for delete, blue for reply)
- **Animations**: Framer Motion spring configurations for natural feel
- **Spacing**: Consistent padding and gap spacing for action elements
- **Typography**: Font-medium for action labels and feedback text
- **Transforms**: Scale and translate transforms for gesture feedback
- **Transitions**: Smooth transitions for state changes

### Gesture States
- **idle**: No gesture detected, card in neutral position
- **dragging**: Active swipe gesture with visual feedback
- **threshold**: Swipe threshold reached, action preview shown
- **action**: Action triggered, appropriate callback executed

### State Management
- **isSwipeActive**: Controls gesture detection and visual feedback
- **swipeThreshold**: Distance required to trigger actions
- **leftAction/rightAction**: Action configurations with icons and colors
- **onSwipeLeft/onSwipeRight**: Callbacks for action execution

### Accessibility
- Proper ARIA labels for action buttons
- Keyboard navigation support for actions
- Screen reader announcements for gesture feedback
- Focus management for interactive elements
- Alternative tap actions for non-touch devices

### Composition Guidelines
✓ **Do**: Use in mobile organisms and touch-enabled templates  
✓ **Do**: Combine atoms logically for gesture interactions  
✓ **Do**: Maintain single responsibility for swipe actions  
✓ **Do**: Provide clear visual feedback for all gestures  
✗ **Don't**: Mix unrelated gesture functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create complex nested gesture interfaces
        `,
      },
    },
  },
  argTypes: {
    swipeThreshold: {
      control: { type: 'range', min: 50, max: 200, step: 10 },
      description: 'Distance required to trigger swipe actions',
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

// Interactive wrapper component  
interface SwipeableCardDemoProps {
  swipeThreshold?: number;
  [key: string]: unknown;
}

const SwipeableCardDemo = ({ swipeThreshold = 100, ...props }: SwipeableCardDemoProps) => {
  const [lastAction, setLastAction] = useState<string>('');
  const [actionCount, setActionCount] = useState(0);

  const handleSwipeLeft = () => {
    setLastAction('Swiped Left (Delete)');
    setActionCount(prev => prev + 1);
  };

  const handleSwipeRight = () => {
    setLastAction('Swiped Right (Reply)');
    setActionCount(prev => prev + 1);
  };

  const handleTap = () => {
    setLastAction('Tapped (Open)');
    setActionCount(prev => prev + 1);
  };

  return (
    <div className="w-full max-w-md space-y-4">
      <SwipeableCard
        onSwipeLeft={handleSwipeLeft}
        onSwipeRight={handleSwipeRight}
        onTap={handleTap}
        swipeThreshold={swipeThreshold}
        leftAction={{
          icon: <span>🗑️</span>,
          color: 'bg-red-500',
          label: 'Delete',
        }}
        rightAction={{
          icon: <span>↩️</span>,
          color: 'bg-blue-500',
          label: 'Reply',
        }}
        className="bg-base-100 border border-base-300 rounded-lg p-4"
        {...props}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
            <span className="text-primary">👤</span>
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">John Doe</div>
            <div className="text-xs text-base-content/60">2 minutes ago</div>
          </div>
          <div className="text-xs text-base-content/60">{actionCount} actions</div>
        </div>
        
        <div className="mt-3 text-sm text-base-content">
          Hey there! This is a swipeable card. Try swiping left or right to see the actions!
        </div>
        
        {lastAction && (
          <div className="mt-3 text-xs text-success bg-success/10 rounded-lg p-2">
            Last Action: {lastAction}
          </div>
        )}
      </SwipeableCard>
      
      <div className="text-center text-xs text-base-content/60 space-y-1">
        <div>← Swipe left to delete</div>
        <div>→ Swipe right to reply</div>
        <div>Tap to open</div>
      </div>
    </div>
  );
};

export const Default: Story = {
  render: () => <SwipeableCardDemo />,
};

export const HighThreshold: Story = {
  render: () => <SwipeableCardDemo swipeThreshold={150} />,
  parameters: {
    docs: {
      description: {
        story: 'Swipeable card with higher swipe threshold (150px) requiring more gesture distance.',
      },
    },
  },
};

export const LowThreshold: Story = {
  render: () => <SwipeableCardDemo swipeThreshold={50} />,
  parameters: {
    docs: {
      description: {
        story: 'Swipeable card with lower swipe threshold (50px) for more sensitive gestures.',
      },
    },
  },
};

export const TimelineMessage: Story = {
  render: () => {
    const [messages, setMessages] = useState([
      { id: 1, text: 'Hey, how are you doing?', time: '2:30 PM' },
      { id: 2, text: 'Great! Just working on some new features.', time: '2:32 PM' },
      { id: 3, text: 'That sounds interesting! Tell me more.', time: '2:35 PM' },
    ]);

    const handleDelete = (id: number) => {
      setMessages(prev => prev.filter(msg => msg.id !== id));
    };

    const handleReply = (id: number) => {
      alert(`Reply to message ${id}`);
    };

    const handleBookmark = (id: number) => {
      alert(`Bookmark message ${id}`);
    };

    return (
      <div className="w-full max-w-md space-y-3">
        <div className="text-center text-sm font-medium text-base-content/60 mb-4">
          Timeline Messages
        </div>
        {messages.map((message) => (
          <SwipeableTimelineMessage
            key={message.id}
            onDelete={() => handleDelete(message.id)}
            onReply={() => handleReply(message.id)}
            onBookmark={() => handleBookmark(message.id)}
            className="bg-base-100 border border-base-300 rounded-lg p-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                <span className="text-primary text-sm">👤</span>
              </div>
              <div className="flex-1">
                <div className="text-sm text-base-content">{message.text}</div>
                <div className="text-xs text-base-content/60 mt-1">{message.time}</div>
              </div>
            </div>
          </SwipeableTimelineMessage>
        ))}
        
        <div className="text-center text-xs text-base-content/60 space-y-1 mt-4">
          <div>← Swipe left to delete</div>
          <div>→ Swipe right to reply</div>
          <div>Tap to bookmark</div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Specialized swipeable cards for timeline messages with delete, reply, and bookmark actions.',
      },
    },
  },
};

export const PullToRefreshDemo: Story = {
  render: () => {
    const [items, setItems] = useState([
      'Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'
    ]);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = async () => {
      setIsRefreshing(true);
      // Simulate refresh delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      setItems(prev => [`New Item ${Date.now()}`, ...prev]);
      setIsRefreshing(false);
    };

    return (
      <div className="w-full max-w-md h-96 overflow-hidden border border-base-300 rounded-lg">
        <PullToRefresh onRefresh={handleRefresh} className="h-full">
          <div className="p-4 space-y-3">
            <div className="text-center text-sm font-medium text-base-content/60">
              Pull down to refresh
            </div>
            {items.map((item, index) => (
              <div
                key={index}
                className="bg-base-100 border border-base-300 rounded-lg p-3 text-sm"
              >
                {item}
              </div>
            ))}
          </div>
        </PullToRefresh>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Pull-to-refresh component for refreshing content with downward gesture.',
      },
    },
  },
};

export const FloatingActionButtonDemo: Story = {
  render: () => {
    const [clicked, setClicked] = useState(false);

    const handleClick = () => {
      setClicked(true);
      setTimeout(() => setClicked(false), 2000);
    };

    return (
      <div className="relative w-full max-w-md h-96 bg-base-200 rounded-lg overflow-hidden">
        <div className="p-4">
          <div className="text-center text-sm font-medium text-base-content/60 mb-4">
            Floating Action Button Demo
          </div>
          <div className="space-y-3">
            <div className="bg-base-100 border border-base-300 rounded-lg p-3 text-sm">
              Content area with floating action button
            </div>
            <div className="bg-base-100 border border-base-300 rounded-lg p-3 text-sm">
              The button is draggable and responds to gestures
            </div>
            <div className="bg-base-100 border border-base-300 rounded-lg p-3 text-sm">
              Try clicking or dragging it around!
            </div>
            {clicked && (
              <div className="bg-success/10 border border-success/20 rounded-lg p-3 text-sm text-success">
                Floating action button clicked!
              </div>
            )}
          </div>
        </div>
        
        <FloatingActionButton
          icon={<span>➕</span>}
          onClick={handleClick}
          position="bottom-right"
          size="md"
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Floating action button with drag gestures and click interactions.',
      },
    },
  },
};

export const LongPressDemo: Story = {
  render: () => {
    const [longPressCount, setLongPressCount] = useState(0);

    const handleLongPress = () => {
      setLongPressCount(prev => prev + 1);
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <div className="text-center text-sm font-medium text-base-content/60">
          Long Press Demo
        </div>
        
        <LongPress
          onLongPress={handleLongPress}
          duration={1000}
          className="bg-base-100 border border-base-300 rounded-lg p-6 text-center cursor-pointer"
        >
          <div className="text-lg mb-2">📱</div>
          <div className="text-sm font-medium">Hold me for 1 second</div>
          <div className="text-xs text-base-content/60 mt-2">
            Long press count: {longPressCount}
          </div>
        </LongPress>
        
        <div className="text-center text-xs text-base-content/60">
          Press and hold the card above to trigger the long press action
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Long press component for detecting extended press gestures.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Swipeable Card Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then swipe, tap, and interact with the cards!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer">
          <h4 className="font-medium mb-3">Swipeable Card</h4>
          <SwipeableCardDemo />
        </div>
        
        <div className="cursor-pointer">
          <h4 className="font-medium mb-3">Long Press</h4>
          {LongPressDemo.render ? LongPressDemo.render({ children: <div>Long Press Demo</div>, ...LongPressDemo.args }, {} as any) : <div>Long Press Demo</div>}
        </div>
        
        <div className="cursor-pointer">
          <h4 className="font-medium mb-3">Floating Action Button</h4>
          {FloatingActionButtonDemo.render ? FloatingActionButtonDemo.render({ children: <div>Floating Action Button Demo</div>, ...FloatingActionButtonDemo.args }, {} as any) : <div>Floating Action Button Demo</div>}
        </div>
        
        <div className="cursor-pointer">
          <h4 className="font-medium mb-3">Pull to Refresh</h4>
          {PullToRefreshDemo.render ? PullToRefreshDemo.render({ children: <div>Pull to Refresh Demo</div>, ...PullToRefreshDemo.args }, {} as any) : <div>Pull to Refresh Demo</div>}
        </div>
      </div>
      
      <div className="text-sm text-gray-600 space-y-1">
        <p>• <strong>Swipe left/right</strong> on cards to trigger actions</p>
        <p>• <strong>Tap cards</strong> to open them</p>
        <p>• <strong>Long press</strong> the card to trigger hold action</p>
        <p>• <strong>Click and drag</strong> the floating action button</p>
        <p>• <strong>Pull down</strong> to refresh content</p>
        <p>• <strong>Hover elements</strong> for tennis commentary feedback!</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing swipeable cards with tennis commentary. Enable commentary in the toolbar and interact with the cards!',
      },
    },
  },
};