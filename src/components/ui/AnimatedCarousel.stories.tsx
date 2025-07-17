import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedCarousel } from './AnimatedCarousel';
import Badge from './Badge';
import CodeBlock from './CodeBlock';

const meta: Meta<typeof AnimatedCarousel> = {
  title: 'Organisms/AnimatedCarousel',
  component: AnimatedCarousel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Enhanced animated carousel component with Framer Motion animations, smooth transitions, drag gestures, and responsive design. Features hover effects, staggered animations, and progress indicators.',
      },
    },
  },
  argTypes: {
    children: {
      description: 'Array of React elements to display in the carousel',
      control: false,
    },
    className: {
      description: 'Additional CSS classes',
      control: 'text',
    },
    showNavigation: {
      description: 'Show navigation arrows with hover animations',
      control: 'boolean',
    },
    showDots: {
      description: 'Show animated dot indicators',
      control: 'boolean',
    },
    autoScroll: {
      description: 'Enable automatic scrolling with pause on interaction',
      control: 'boolean',
    },
    scrollInterval: {
      description: 'Auto-scroll interval in milliseconds',
      control: 'number',
    },
    itemsPerView: {
      description: 'Number of items per view for different screen sizes',
      control: 'object',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnimatedCarousel>;

// Enhanced card component with animations
const AnimatedCard = ({ 
  title, 
  content, 
  color = 'bg-primary',
  icon = '✨'
}: { 
  title: string; 
  content: string; 
  color?: string;
  icon?: string;
}) => (
  <div className={`${color} text-primary-content rounded-xl p-6 min-h-[240px] flex flex-col justify-between w-full shadow-lg hover:shadow-xl transition-shadow duration-300`}>
    <div>
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-bold text-xl mb-2">{title}</h3>
      <p className="text-sm opacity-90 leading-relaxed">{content}</p>
    </div>
    <div className="flex justify-between items-center mt-4">
      <Badge variant="outline" className="border-white/30 text-white">Animated</Badge>
      <span className="text-xs opacity-75">Interactive</span>
    </div>
  </div>
);

// Feature showcase cards
const featureCards = [
  {
    title: 'Smooth Animations',
    content: 'Powered by Framer Motion with spring physics and easing curves for natural movement',
    color: 'bg-gradient-to-br from-purple-500 to-pink-500',
    icon: '🌟',
  },
  {
    title: 'Drag Gestures',
    content: 'Touch and mouse drag support with momentum-based navigation and elastic constraints',
    color: 'bg-gradient-to-br from-blue-500 to-teal-500',
    icon: '👆',
  },
  {
    title: 'Responsive Design',
    content: 'Automatically adapts items per view based on screen size with smooth transitions',
    color: 'bg-gradient-to-br from-green-500 to-blue-500',
    icon: '📱',
  },
  {
    title: 'Auto-Scroll',
    content: 'Intelligent auto-scrolling that pauses on user interaction and resumes gracefully',
    color: 'bg-gradient-to-br from-orange-500 to-red-500',
    icon: '⏱️',
  },
  {
    title: 'Hover Effects',
    content: 'Subtle hover animations with lift effects and shadow enhancement for better UX',
    color: 'bg-gradient-to-br from-indigo-500 to-purple-500',
    icon: '🎯',
  },
  {
    title: 'Progress Tracking',
    content: 'Visual progress indicator showing current position with smooth animated updates',
    color: 'bg-gradient-to-br from-cyan-500 to-blue-500',
    icon: '📊',
  },
];

export const Default: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    scrollInterval: 5000,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 3 },
  },
  render: (args) => (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">✨ Animated Feature Showcase</h3>
        <p className="text-base-content/70 mb-4">
          Experience smooth animations, hover effects, and responsive design
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-primary">Framer Motion</div>
          <div className="badge badge-secondary">Drag Gestures</div>
          <div className="badge badge-accent">Spring Physics</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {featureCards.map((card, index) => (
          <AnimatedCard key={index} {...card} />
        ))}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default animated carousel with navigation arrows, dots, hover effects, and responsive design.',
      },
    },
  },
};

export const AutoScrollDemo: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: true,
    scrollInterval: 3000,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 2 },
  },
  render: (args) => (
    <div className="w-full max-w-5xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">🔄 Auto-Scroll Animation</h3>
        <p className="text-base-content/70 mb-4">
          Automatic scrolling every 3 seconds with pause on interaction
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-success">Auto-Scroll: ON</div>
          <div className="badge badge-warning">Interval: 3s</div>
          <div className="badge badge-info">Pauses on Interaction</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {[
          <AnimatedCard key="1" title="Step 1" content="Introduction with animated entrance" color="bg-gradient-to-br from-emerald-500 to-teal-500" icon="🚀" />,
          <AnimatedCard key="2" title="Step 2" content="Feature overview with smooth transitions" color="bg-gradient-to-br from-blue-500 to-indigo-500" icon="⭐" />,
          <AnimatedCard key="3" title="Step 3" content="Interactive demonstration" color="bg-gradient-to-br from-purple-500 to-pink-500" icon="🎨" />,
          <AnimatedCard key="4" title="Step 4" content="Complete the journey" color="bg-gradient-to-br from-orange-500 to-red-500" icon="🏁" />,
        ]}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Auto-scrolling carousel with animated transitions that automatically advances every 3 seconds.',
      },
    },
  },
};

export const DragGestureDemo: Story = {
  args: {
    showNavigation: false,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 1, desktop: 1 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">👆 Drag Gesture Navigation</h3>
        <p className="text-base-content/70 mb-4">
          Try dragging left or right to navigate between slides
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-primary">Touch Enabled</div>
          <div className="badge badge-secondary">Mouse Drag</div>
          <div className="badge badge-accent">Momentum Physics</div>
          <div className="badge badge-info">Elastic Constraints</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {[
          <div key="1" className="bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-xl p-8 min-h-[320px] flex flex-col justify-center items-center">
            <div className="text-6xl mb-4">👆</div>
            <h3 className="text-3xl font-bold mb-4">Drag Me!</h3>
            <p className="text-center text-lg opacity-90">Swipe or drag to navigate</p>
          </div>,
          <div key="2" className="bg-gradient-to-br from-cyan-600 to-blue-600 text-white rounded-xl p-8 min-h-[320px] flex flex-col justify-center items-center">
            <div className="text-6xl mb-4">✨</div>
            <h3 className="text-3xl font-bold mb-4">Smooth Motion</h3>
            <p className="text-center text-lg opacity-90">Spring physics for natural feel</p>
          </div>,
          <div key="3" className="bg-gradient-to-br from-emerald-600 to-green-600 text-white rounded-xl p-8 min-h-[320px] flex flex-col justify-center items-center">
            <div className="text-6xl mb-4">🎯</div>
            <h3 className="text-3xl font-bold mb-4">Snap to Position</h3>
            <p className="text-center text-lg opacity-90">Intelligent snap behavior</p>
          </div>,
        ]}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Drag gesture navigation with momentum physics and elastic constraints for natural interaction.',
      },
    },
  },
};

export const ResponsiveAnimation: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 4 },
  },
  render: (args) => (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">📱 Responsive Animations</h3>
        <p className="text-base-content/70 mb-4">
          Resize your browser to see adaptive items per view with smooth transitions
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-outline">Mobile: 1 item</div>
          <div className="badge badge-outline">Tablet: 2 items</div>
          <div className="badge badge-outline">Desktop: 4 items</div>
          <div className="badge badge-success">Smooth Transitions</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {Array.from({ length: 12 }, (_, i) => (
          <AnimatedCard 
            key={i} 
            title={`Card ${i + 1}`} 
            content={`Responsive item with staggered animations and hover effects`}
            color={`bg-gradient-to-br from-${['purple', 'blue', 'green', 'yellow', 'pink', 'indigo'][i % 6]}-500 to-${['pink', 'indigo', 'teal', 'orange', 'purple', 'blue'][i % 6]}-500`}
            icon={['🌟', '⚡', '🎨', '🚀', '💎', '🔥'][i % 6]}
          />
        ))}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Responsive carousel that adapts items per view based on screen size with smooth animated transitions.',
      },
    },
  },
};

export const StaggeredAnimations: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 3 },
  },
  render: (args) => (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">⚡ Staggered Entry Animations</h3>
        <p className="text-base-content/70 mb-4">
          Watch items animate in with staggered timing for a polished feel
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-primary">Staggered Entry</div>
          <div className="badge badge-secondary">Hover Lift</div>
          <div className="badge badge-accent">Spring Physics</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {[
          <AnimatedCard key="1" title="Animation 1" content="First item with entrance animation and hover effects" color="bg-gradient-to-br from-red-500 to-pink-500" icon="1️⃣" />,
          <AnimatedCard key="2" title="Animation 2" content="Second item with staggered timing for smooth sequence" color="bg-gradient-to-br from-orange-500 to-red-500" icon="2️⃣" />,
          <AnimatedCard key="3" title="Animation 3" content="Third item completing the animated sequence" color="bg-gradient-to-br from-yellow-500 to-orange-500" icon="3️⃣" />,
          <AnimatedCard key="4" title="Animation 4" content="Fourth item with continued stagger pattern" color="bg-gradient-to-br from-green-500 to-yellow-500" icon="4️⃣" />,
          <AnimatedCard key="5" title="Animation 5" content="Fifth item maintaining the rhythm" color="bg-gradient-to-br from-blue-500 to-green-500" icon="5️⃣" />,
          <AnimatedCard key="6" title="Animation 6" content="Final item with polished entrance timing" color="bg-gradient-to-br from-purple-500 to-blue-500" icon="6️⃣" />,
        ]}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of staggered entry animations with hover effects and spring physics.',
      },
    },
  },
};

export const CodeExamplesCarousel: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 1, desktop: 1 },
  },
  render: (args) => (
    <div className="w-full max-w-5xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">💻 Animated Code Examples</h3>
        <p className="text-base-content/70 mb-4">
          Code snippets with smooth transitions and syntax highlighting
        </p>
      </div>
      <AnimatedCarousel {...args}>
        {[
          <div key="tsx" className="w-full bg-base-100 rounded-xl p-6 border border-base-300 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <div className="text-2xl">⚛️</div>
              <h4 className="font-bold text-lg">React Animation Hook</h4>
            </div>
            <CodeBlock
              code={`const useAnimatedCarousel = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  
  const nextSlide = useCallback(() => {
    setIsAnimating(true);
    setCurrentIndex(prev => prev + 1);
  }, []);
  
  return { currentIndex, nextSlide, isAnimating };
};`}
              language="tsx"
              showLineNumbers={true}
              className="text-sm"
            />
          </div>,
          <div key="css" className="w-full bg-base-100 rounded-xl p-6 border border-base-300 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <div className="text-2xl">🎨</div>
              <h4 className="font-bold text-lg">CSS Animations</h4>
            </div>
            <CodeBlock
              code={`.animated-carousel {
  transform: translateX(var(--offset));
  transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.carousel-item {
  transition: all 0.3s ease;
}

.carousel-item:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}`}
              language="css"
              showLineNumbers={true}
              className="text-sm"
            />
          </div>,
          <div key="motion" className="w-full bg-base-100 rounded-xl p-6 border border-base-300 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <div className="text-2xl">🌟</div>
              <h4 className="font-bold text-lg">Framer Motion Config</h4>
            </div>
            <CodeBlock
              code={`const springConfig = {
  type: "spring",
  damping: 20,
  stiffness: 100
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
};

const staggerItem = {
  initial: { opacity: 0, y: 20 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: springConfig
  }
};`}
              language="typescript"
              showLineNumbers={true}
              className="text-sm"
            />
          </div>,
        ]}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Code examples carousel showcasing animation implementation with syntax highlighting.',
      },
    },
  },
};

export const ProgressIndicator: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: true,
    scrollInterval: 4000,
    itemsPerView: { mobile: 1, tablet: 1, desktop: 1 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">📊 Progress Tracking</h3>
        <p className="text-base-content/70 mb-4">
          Visual progress indicator with smooth animations and auto-advance
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-primary">Progress Bar</div>
          <div className="badge badge-secondary">Auto-Advance</div>
          <div className="badge badge-accent">Smooth Updates</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {[
          <div key="progress-1" className="bg-gradient-to-br from-blue-600 to-purple-600 text-white rounded-xl p-8 min-h-[300px] flex flex-col justify-center items-center">
            <div className="text-5xl mb-4">🎯</div>
            <h3 className="text-2xl font-bold mb-4">Progress Step 1</h3>
            <p className="text-center opacity-90">Watch the progress bar animate</p>
          </div>,
          <div key="progress-2" className="bg-gradient-to-br from-purple-600 to-pink-600 text-white rounded-xl p-8 min-h-[300px] flex flex-col justify-center items-center">
            <div className="text-5xl mb-4">⚡</div>
            <h3 className="text-2xl font-bold mb-4">Progress Step 2</h3>
            <p className="text-center opacity-90">Smooth transitions between states</p>
          </div>,
          <div key="progress-3" className="bg-gradient-to-br from-pink-600 to-red-600 text-white rounded-xl p-8 min-h-[300px] flex flex-col justify-center items-center">
            <div className="text-5xl mb-4">🚀</div>
            <h3 className="text-2xl font-bold mb-4">Progress Step 3</h3>
            <p className="text-center opacity-90">Real-time progress updates</p>
          </div>,
          <div key="progress-4" className="bg-gradient-to-br from-red-600 to-orange-600 text-white rounded-xl p-8 min-h-[300px] flex flex-col justify-center items-center">
            <div className="text-5xl mb-4">🏁</div>
            <h3 className="text-2xl font-bold mb-4">Complete!</h3>
            <p className="text-center opacity-90">Journey finished with style</p>
          </div>,
        ]}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Progress indicator demonstration with auto-advance and smooth progress bar animations.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 3 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">🚫 Empty State</h3>
        <p className="text-base-content/70 mb-4">
          Carousel with no items (should render nothing)
        </p>
      </div>
      <AnimatedCarousel {...args}>
        {[]}
      </AnimatedCarousel>
      <div className="mt-6 p-6 bg-base-200 rounded-lg text-center">
        <p className="text-base-content/60">
          No carousel is rendered when there are no items to display
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Empty state handling - component returns null when no items are provided.',
      },
    },
  },
};

export const InteractionShowcase: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: true,
    scrollInterval: 5000,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 2 },
  },
  render: (args) => (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-3">🎮 Complete Interaction Demo</h3>
        <p className="text-base-content/70 mb-4">
          Try all interaction methods with enhanced animations
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="badge badge-primary">Animated Arrows</div>
          <div className="badge badge-secondary">Interactive Dots</div>
          <div className="badge badge-accent">Drag Gestures</div>
          <div className="badge badge-success">Hover Effects</div>
          <div className="badge badge-warning">Auto-Scroll</div>
          <div className="badge badge-info">Progress Bar</div>
        </div>
      </div>
      <AnimatedCarousel {...args}>
        {[
          <div key="interaction-1" className="bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-xl p-6 min-h-[280px] flex flex-col justify-center items-center w-full">
            <div className="text-4xl mb-3">🎯</div>
            <h3 className="text-xl font-bold mb-2">Click Arrows</h3>
            <p className="text-center text-sm opacity-90">Animated navigation buttons</p>
          </div>,
          <div key="interaction-2" className="bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-xl p-6 min-h-[280px] flex flex-col justify-center items-center w-full">
            <div className="text-4xl mb-3">⚪</div>
            <h3 className="text-xl font-bold mb-2">Dot Navigation</h3>
            <p className="text-center text-sm opacity-90">Interactive progress dots</p>
          </div>,
          <div key="interaction-3" className="bg-gradient-to-br from-emerald-600 to-teal-600 text-white rounded-xl p-6 min-h-[280px] flex flex-col justify-center items-center w-full">
            <div className="text-4xl mb-3">👆</div>
            <h3 className="text-xl font-bold mb-2">Drag & Swipe</h3>
            <p className="text-center text-sm opacity-90">Touch and mouse gestures</p>
          </div>,
          <div key="interaction-4" className="bg-gradient-to-br from-orange-600 to-red-600 text-white rounded-xl p-6 min-h-[280px] flex flex-col justify-center items-center w-full">
            <div className="text-4xl mb-3">✨</div>
            <h3 className="text-xl font-bold mb-2">Hover Magic</h3>
            <p className="text-center text-sm opacity-90">Lift effects and shadows</p>
          </div>,
          <div key="interaction-5" className="bg-gradient-to-br from-pink-600 to-purple-600 text-white rounded-xl p-6 min-h-[280px] flex flex-col justify-center items-center w-full">
            <div className="text-4xl mb-3">🔄</div>
            <h3 className="text-xl font-bold mb-2">Auto-Scroll</h3>
            <p className="text-center text-sm opacity-90">Pauses on interaction</p>
          </div>,
        ]}
      </AnimatedCarousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Complete interaction showcase demonstrating all animated features and interaction methods.',
      },
    },
  },
};