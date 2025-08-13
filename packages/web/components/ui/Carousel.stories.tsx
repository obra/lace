// ABOUTME: Storybook story for Carousel.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Carousel } from './Carousel';
import Badge from './Badge';
import CodeBlock from './CodeBlock';

const meta: Meta<typeof Carousel> = {
  title: 'Organisms/Carousel',
  component: Carousel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Responsive carousel component with navigation, dots, auto-scroll, and touch/keyboard support. Displays multiple items per view with customizable breakpoints and smooth transitions.',
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
      description: 'Show navigation arrows',
      control: 'boolean',
    },
    showDots: {
      description: 'Show dot indicators',
      control: 'boolean',
    },
    autoScroll: {
      description: 'Enable automatic scrolling',
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
type Story = StoryObj<typeof Carousel>;

// Sample card component for testing
const SampleCard = ({ title, content, color = 'bg-primary' }: { title: string; content: string; color?: string }) => (
  <div className={`${color} text-primary-content rounded-lg p-4 min-h-[200px] flex flex-col justify-between w-full`}>
    <h3 className="font-semibold text-lg">{title}</h3>
    <p className="text-sm opacity-90">{content}</p>
    <div className="flex justify-between items-center mt-2">
      <Badge variant="outline">Sample</Badge>
      <span className="text-xs opacity-75">Card</span>
    </div>
  </div>
);

// Sample code blocks for code carousel
const codeExamples = [
  {
    title: 'React Component',
    language: 'tsx',
    code: `function MyComponent() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}`,
  },
  {
    title: 'TypeScript Interface',
    language: 'typescript',
    code: `interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  createdAt: Date;
}

type UserStatus = 'active' | 'inactive' | 'pending';`,
  },
  {
    title: 'CSS Styles',
    language: 'css',
    code: `.carousel-container {
  display: flex;
  overflow-x: auto;
  scroll-behavior: smooth;
  gap: 1rem;
}

.carousel-item {
  flex: 0 0 auto;
  min-width: 300px;
}`,
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
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Product Showcase</h3>
        <p className="text-sm text-base-content/60">
          Browse through our featured products with navigation and dots
        </p>
      </div>
      <Carousel {...args}>
        {[
          <SampleCard key="1" title="Product A" content="High-quality product with excellent features" color="bg-primary" />,
          <SampleCard key="2" title="Product B" content="Innovative solution for modern challenges" color="bg-secondary" />,
          <SampleCard key="3" title="Product C" content="Reliable and efficient performance" color="bg-accent" />,
          <SampleCard key="4" title="Product D" content="User-friendly design with premium quality" color="bg-success" />,
          <SampleCard key="5" title="Product E" content="Advanced technology with seamless integration" color="bg-warning" />,
          <SampleCard key="6" title="Product F" content="Comprehensive solution for all your needs" color="bg-error" />,
        ]}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default carousel with navigation arrows, dots, and responsive design showing 1-3 items per view.',
      },
    },
  },
};

export const AutoScroll: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: true,
    scrollInterval: 3000,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 2 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Auto-Scrolling Carousel</h3>
        <p className="text-sm text-base-content/60">
          Automatically scrolls every 3 seconds (pauses on interaction)
        </p>
        <div className="flex items-center gap-2 mt-2">
          <div className="badge badge-outline">Auto-Scroll: ON</div>
          <div className="badge badge-outline">Interval: 3s</div>
        </div>
      </div>
      <Carousel {...args}>
        {[
          <SampleCard key="1" title="Announcement 1" content="Important update about our services" color="bg-info" />,
          <SampleCard key="2" title="Announcement 2" content="New features now available" color="bg-success" />,
          <SampleCard key="3" title="Announcement 3" content="Upcoming maintenance schedule" color="bg-warning" />,
          <SampleCard key="4" title="Announcement 4" content="Customer testimonials" color="bg-primary" />,
        ]}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Auto-scrolling carousel that automatically advances every 3 seconds. Interaction pauses auto-scroll.',
      },
    },
  },
};

export const CodeCarousel: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 1, desktop: 1 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Code Examples</h3>
        <p className="text-sm text-base-content/60">
          Browse through different code examples with syntax highlighting
        </p>
      </div>
      <Carousel {...args}>
        {codeExamples.map((example, index) => (
          <div key={index} className="w-full">
            <div className="bg-base-100 rounded-lg p-4 border border-base-300">
              <h4 className="font-semibold mb-3">{example.title}</h4>
              <CodeBlock
                code={example.code}
                language={example.language}
                showLineNumbers={true}
                className="text-sm"
              />
            </div>
          </div>
        ))}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Code carousel showing syntax-highlighted code examples with full-width display.',
      },
    },
  },
};

export const MinimalCarousel: Story = {
  args: {
    showNavigation: false,
    showDots: false,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 3 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Minimal Carousel</h3>
        <p className="text-sm text-base-content/60">
          Minimal carousel with touch/swipe support only (no arrows or dots)
        </p>
        <div className="flex items-center gap-2 mt-2">
          <div className="badge badge-outline">Touch/Swipe Enabled</div>
          <div className="badge badge-outline">Keyboard Navigation</div>
        </div>
      </div>
      <Carousel {...args}>
        {[
          <SampleCard key="1" title="Image 1" content="Beautiful landscape photo" color="bg-primary" />,
          <SampleCard key="2" title="Image 2" content="Urban architecture shot" color="bg-secondary" />,
          <SampleCard key="3" title="Image 3" content="Natural wildlife capture" color="bg-accent" />,
          <SampleCard key="4" title="Image 4" content="Abstract art composition" color="bg-success" />,
        ]}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Minimal carousel without navigation arrows or dots. Supports touch/swipe gestures and keyboard navigation.',
      },
    },
  },
};

export const SingleItemView: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 1, desktop: 1 },
  },
  render: (args) => (
    <div className="w-full max-w-2xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Single Item View</h3>
        <p className="text-sm text-base-content/60">
          Full-width carousel showing one item at a time on all screen sizes
        </p>
      </div>
      <Carousel {...args}>
        {[
          <div key="1" className="w-full bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-lg p-8 min-h-[300px] flex flex-col justify-center items-center">
            <h3 className="text-2xl font-bold mb-4">Welcome</h3>
            <p className="text-center opacity-90">Start your journey with us</p>
          </div>,
          <div key="2" className="w-full bg-gradient-to-br from-blue-500 to-teal-500 text-white rounded-lg p-8 min-h-[300px] flex flex-col justify-center items-center">
            <h3 className="text-2xl font-bold mb-4">Explore</h3>
            <p className="text-center opacity-90">Discover amazing features</p>
          </div>,
          <div key="3" className="w-full bg-gradient-to-br from-green-500 to-blue-500 text-white rounded-lg p-8 min-h-[300px] flex flex-col justify-center items-center">
            <h3 className="text-2xl font-bold mb-4">Create</h3>
            <p className="text-center opacity-90">Build something amazing</p>
          </div>,
        ]}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Single item carousel perfect for hero sections, onboarding, or featured content.',
      },
    },
  },
};

export const ResponsiveItems: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 4 },
  },
  render: (args) => (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Responsive Items Per View</h3>
        <p className="text-sm text-base-content/60">
          Mobile: 1 item, Tablet: 2 items, Desktop: 4 items
        </p>
        <div className="flex items-center gap-2 mt-2">
          <div className="badge badge-outline">Mobile: 1</div>
          <div className="badge badge-outline">Tablet: 2</div>
          <div className="badge badge-outline">Desktop: 4</div>
        </div>
      </div>
      <Carousel {...args}>
        {Array.from({ length: 12 }, (_, i) => (
          <SampleCard 
            key={i} 
            title={`Item ${i + 1}`} 
            content={`Description for item ${i + 1}`} 
            color={`bg-${['primary', 'secondary', 'accent', 'success', 'warning', 'error'][i % 6]}`}
          />
        ))}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Responsive carousel with different items per view on different screen sizes.',
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
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Empty Carousel</h3>
        <p className="text-sm text-base-content/60">
          Carousel with no items (should render nothing)
        </p>
      </div>
      <Carousel {...args}>
        {[]}
      </Carousel>
      <div className="mt-4 p-4 bg-base-200 rounded-lg text-center">
        <p className="text-sm text-base-content/60">
          No carousel is rendered when there are no items
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Empty carousel state - component returns null when no items are provided.',
      },
    },
  },
};

export const CustomStyling: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: false,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 3 },
    className: 'bg-base-200 rounded-lg p-4',
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Custom Styling</h3>
        <p className="text-sm text-base-content/60">
          Carousel with custom background and padding
        </p>
      </div>
      <Carousel {...args}>
        {[
          <div key="1" className="bg-white rounded-lg p-4 min-h-[200px] flex flex-col justify-center items-center shadow-lg">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Custom Card 1</h3>
            <p className="text-sm text-gray-600 text-center">Styled with custom background</p>
          </div>,
          <div key="2" className="bg-white rounded-lg p-4 min-h-[200px] flex flex-col justify-center items-center shadow-lg">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Custom Card 2</h3>
            <p className="text-sm text-gray-600 text-center">Consistent styling theme</p>
          </div>,
          <div key="3" className="bg-white rounded-lg p-4 min-h-[200px] flex flex-col justify-center items-center shadow-lg">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Custom Card 3</h3>
            <p className="text-sm text-gray-600 text-center">Professional appearance</p>
          </div>,
        ]}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Carousel with custom styling applied via className prop.',
      },
    },
  },
};

export const InteractionDemo: Story = {
  args: {
    showNavigation: true,
    showDots: true,
    autoScroll: true,
    scrollInterval: 4000,
    itemsPerView: { mobile: 1, tablet: 2, desktop: 2 },
  },
  render: (args) => (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Interaction Demo</h3>
        <p className="text-sm text-base-content/60">
          Try different interaction methods:
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="badge badge-outline">Click arrows</div>
          <div className="badge badge-outline">Click dots</div>
          <div className="badge badge-outline">Touch/swipe</div>
          <div className="badge badge-outline">Keyboard (←/→)</div>
          <div className="badge badge-outline">Auto-scroll (pauses on interaction)</div>
        </div>
      </div>
      <Carousel {...args}>
        {[
          <div key="1" className="bg-primary text-primary-content rounded-lg p-6 min-h-[250px] flex flex-col justify-center items-center w-full">
            <h3 className="text-xl font-bold mb-2">🎯 Interaction 1</h3>
            <p className="text-center">Click the arrow buttons to navigate</p>
          </div>,
          <div key="2" className="bg-secondary text-secondary-content rounded-lg p-6 min-h-[250px] flex flex-col justify-center items-center w-full">
            <h3 className="text-xl font-bold mb-2">🎨 Interaction 2</h3>
            <p className="text-center">Click the dots below to jump to any page</p>
          </div>,
          <div key="3" className="bg-accent text-accent-content rounded-lg p-6 min-h-[250px] flex flex-col justify-center items-center w-full">
            <h3 className="text-xl font-bold mb-2">📱 Interaction 3</h3>
            <p className="text-center">Swipe or drag on touch devices</p>
          </div>,
          <div key="4" className="bg-success text-success-content rounded-lg p-6 min-h-[250px] flex flex-col justify-center items-center w-full">
            <h3 className="text-xl font-bold mb-2">⌨️ Interaction 4</h3>
            <p className="text-center">Use arrow keys when focused</p>
          </div>,
          <div key="5" className="bg-warning text-warning-content rounded-lg p-6 min-h-[250px] flex flex-col justify-center items-center w-full">
            <h3 className="text-xl font-bold mb-2">🔄 Interaction 5</h3>
            <p className="text-center">Auto-scroll pauses when you interact</p>
          </div>,
        ]}
      </Carousel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive carousel demonstrating all supported interaction methods including navigation, touch, keyboard, and auto-scroll.',
      },
    },
  },
};