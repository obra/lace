import type { Meta, StoryObj } from '@storybook/react';
import { 
  getComponentsByCategory, 
  getComponentStats, 
  getOverallStats, 
  generateStoryLink, 
  getStatusIndicator,
  getComponentsBySubcategory,
  getSubcategories
} from './component-registry';

// Generate stats at build time
const atomStats = getComponentStats('atoms');
const moleculeStats = getComponentStats('molecules');
const organismStats = getComponentStats('organisms');
const templateStats = getComponentStats('templates');
const pageStats = getComponentStats('pages');
const overallStats = getOverallStats();

const meta: Meta = {
  title: 'Design System/Overview',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
# Lace Design System

## Atomic Design Philosophy

Our design system follows **Brad Frost's Atomic Design** methodology, creating a hierarchical system of reusable components that build upon each other to create consistent, scalable interfaces.

*This overview is automatically updated from the component registry. The registry now includes all priority organisms with comprehensive stories.*

---

## 🔬 Atoms
*The foundational building blocks of our interface*

**Complete: ${atomStats.withStories} of ${atomStats.total} components (${atomStats.completionPercentage}%)**

All atoms are complete with comprehensive Storybook documentation. These foundational components include interactive elements, content display, input controls, and feedback mechanisms.

---

## 🧬 Molecules
*Simple groups of atoms functioning together*

**Complete: ${moleculeStats.withStories} of ${moleculeStats.total} components (${moleculeStats.completionPercentage}%)**

Molecules combine atoms into functional groups. All core molecules are now complete, including message components, navigation elements, interactive controls, and specialized UI patterns like animations and gestures.

---

## 🦠 Organisms
*Complex UI components built from molecules and atoms*

**Complete: ${organismStats.withStories} of ${organismStats.total} components (${organismStats.completionPercentage}%)**

Organisms are complex UI components that combine molecules and atoms. These include layout components, content displays, and interactive interfaces. Priority organisms (TimelineView, TaskBoardModal, MobileSidebar, ChatHeader) are now complete with comprehensive stories.

---

## 📋 Templates
*Page-level layouts combining organisms*

**Complete: ${templateStats.withStories} of ${templateStats.total} components (${templateStats.completionPercentage}%)**

Templates define page-level layouts and structures using organisms and molecules.

---

## 📄 Pages
*Complete page implementations*

**Complete: ${pageStats.withStories} of ${pageStats.total} components (${pageStats.completionPercentage}%)**

Pages are complete user interfaces built from templates, organisms, molecules, and atoms. LaceApp now has comprehensive stories with multiple variations and interactive demos.

---

## Overall Progress

**${overallStats.completionPercentage}% Complete** (${overallStats.withStories} of ${overallStats.total} components)

## Design Tokens

### Colors
- **Base Colors**: \`base-content\`, \`base-200\`, \`base-300\` for backgrounds and text
- **Semantic Colors**: \`primary\`, \`secondary\`, \`accent\`, \`success\`, \`warning\`, \`error\`, \`info\`
- **Custom Colors**: \`teal-500\` for specialized use cases

### Typography
- **Font Weights**: \`font-medium\`, \`font-semibold\` for hierarchy
- **Font Sizes**: \`text-sm\`, \`text-base\`, \`text-lg\` for content scaling
- **Line Heights**: \`leading-relaxed\` for readability

### Spacing
- **Padding**: \`p-2\`, \`p-3\`, \`p-4\` for consistent spacing
- **Margins**: \`m-2\`, \`m-3\`, \`m-4\` for component separation
- **Gaps**: \`gap-2\`, \`gap-3\`, \`gap-4\` for flex layouts

### Borders & Radius
- **Border Radius**: \`rounded\`, \`rounded-lg\`, \`rounded-md\` for modern appearance
- **Borders**: \`border\`, \`border-2\` with semantic colors

---

## Component Guidelines

### ✅ Do
- **Use semantic HTML** for accessibility
- **Follow atomic design principles** when building new components
- **Maintain consistent spacing** using design tokens
- **Provide proper ARIA labels** for interactive elements
- **Test with keyboard navigation** and screen readers
- **Create comprehensive Storybook stories** for every component
- **Include Interactive Demo stories** with tennis commentary support

### ❌ Don't
- **Mix abstraction levels** (atoms shouldn't contain molecules)
- **Override base styling** without good reason
- **Create one-off components** without considering reusability
- **Ignore accessibility** requirements
- **Use hardcoded values** instead of design tokens
- **Skip documentation** or story creation

---

## Development Process

### 1. **Component Creation**
- Build component following atomic design principles
- Use proper TypeScript interfaces and props
- Implement accessibility features from the start
- Follow naming conventions and code style

### 2. **Storybook Stories**
- Create comprehensive stories covering all variants
- Include proper documentation with "Atomic Classification" and "Composed of" sections
- Add Interactive Demo story with tennis commentary support
- Test all props and edge cases

### 3. **Testing & Validation**
- Run \`npm test\` to ensure all stories pass
- Verify accessibility with keyboard navigation
- Test on different screen sizes and themes
- Validate prop types and error handling

### 4. **Integration**
- Component registry is automatically updated with all new components
- Registry tracks story completion status
- Design system overview reflects current progress
- No manual updates needed for existing components

---

## Resources

- **[Atomic Design by Brad Frost](https://bradfrost.com/blog/post/atomic-web-design/)**
- **[Storybook Documentation](https://storybook.js.org/docs)**
- **[Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)**
- **[DaisyUI Components](https://daisyui.com/components/)**

*This overview is automatically generated from the component registry. Component counts and status update when the registry is updated.*
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DesignSystemOverview: Story = {
  render: () => {
    const atomStatus = getStatusIndicator(atomStats.completionPercentage);
    const moleculeStatus = getStatusIndicator(moleculeStats.completionPercentage);
    const organismStatus = getStatusIndicator(organismStats.completionPercentage);
    const templateStatus = getStatusIndicator(templateStats.completionPercentage);
    const pageStatus = getStatusIndicator(pageStats.completionPercentage);
    
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Lace Design System</h1>
          <p className="text-lg text-gray-600">
            A comprehensive atomic design system for building consistent, scalable interfaces
          </p>
          <div className="mt-4 text-sm text-gray-500">
            Automatically updated from {overallStats.total} components • {overallStats.completionPercentage}% complete
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Atoms Section */}
          <div className="bg-blue-50 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">🔬</span>
              <h2 className="text-xl font-semibold">Atoms</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Foundational building blocks
            </p>
            <div className="space-y-2 text-sm">
              {getSubcategories('atoms').map(subcategory => (
                <div key={subcategory} className="flex justify-between">
                  <span>{subcategory}</span>
                  <span className="font-medium">{getComponentsBySubcategory('atoms', subcategory).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-blue-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">{atomStats.completionPercentage}% Complete</span>
                <span className={`font-medium text-${atomStatus.color}-600`}>
                  {atomStatus.emoji} {atomStatus.text}
                </span>
              </div>
            </div>
          </div>

          {/* Molecules Section */}
          <div className="bg-green-50 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">🧬</span>
              <h2 className="text-xl font-semibold">Molecules</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Groups of atoms functioning together
            </p>
            <div className="space-y-2 text-sm">
              {getSubcategories('molecules').map(subcategory => (
                <div key={subcategory} className="flex justify-between">
                  <span>{subcategory}</span>
                  <span className="font-medium">{getComponentsBySubcategory('molecules', subcategory).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-green-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">{moleculeStats.completionPercentage}% Complete</span>
                <span className={`font-medium text-${moleculeStatus.color}-600`}>
                  {moleculeStatus.emoji} {moleculeStatus.text}
                </span>
              </div>
            </div>
          </div>

          {/* Organisms Section */}
          <div className="bg-purple-50 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">🦠</span>
              <h2 className="text-xl font-semibold">Organisms</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Complex UI components
            </p>
            <div className="space-y-2 text-sm">
              {getSubcategories('organisms').map(subcategory => (
                <div key={subcategory} className="flex justify-between">
                  <span>{subcategory}</span>
                  <span className="font-medium">{getComponentsBySubcategory('organisms', subcategory).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-purple-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">{organismStats.completionPercentage}% Complete</span>
                <span className={`font-medium text-${organismStatus.color}-600`}>
                  {organismStatus.emoji} {organismStatus.text}
                </span>
              </div>
            </div>
          </div>

          {/* Templates Section */}
          <div className="bg-orange-50 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">📋</span>
              <h2 className="text-xl font-semibold">Templates</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Page-level layouts
            </p>
            <div className="space-y-2 text-sm">
              {getSubcategories('templates').map(subcategory => (
                <div key={subcategory} className="flex justify-between">
                  <span>{subcategory}</span>
                  <span className="font-medium">{getComponentsBySubcategory('templates', subcategory).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-orange-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">{templateStats.completionPercentage}% Complete</span>
                <span className={`font-medium text-${templateStatus.color}-600`}>
                  {templateStatus.emoji} {templateStatus.text}
                </span>
              </div>
            </div>
          </div>

          {/* Pages Section */}
          <div className="bg-red-50 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">📄</span>
              <h2 className="text-xl font-semibold">Pages</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Complete page implementations
            </p>
            <div className="space-y-2 text-sm">
              {getSubcategories('pages').map(subcategory => (
                <div key={subcategory} className="flex justify-between">
                  <span>{subcategory}</span>
                  <span className="font-medium">{getComponentsBySubcategory('pages', subcategory).length}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-red-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">{pageStats.completionPercentage}% Complete</span>
                <span className={`font-medium text-${pageStatus.color}-600`}>
                  {pageStatus.emoji} {pageStatus.text}
                </span>
              </div>
            </div>
          </div>

          {/* Overall Progress */}
          <div className="bg-gray-50 p-6 rounded-lg">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">📊</span>
              <h2 className="text-xl font-semibold">Overall Progress</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Complete system status
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Total Components</span>
                <span className="font-medium">{overallStats.total}</span>
              </div>
              <div className="flex justify-between">
                <span>With Stories</span>
                <span className="font-medium">{overallStats.withStories}</span>
              </div>
              <div className="flex justify-between">
                <span>Missing Stories</span>
                <span className="font-medium">{overallStats.withoutStories}</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <span className="font-medium">{overallStats.completionPercentage}% Complete</span>
                <span className="text-blue-600 font-medium">
                  🎯 {overallStats.withStories}/{overallStats.total}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 bg-blue-100 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Quick Navigation</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <a href="?path=/docs/atoms-agentbadge--docs" className="text-blue-600 hover:underline">
              🔬 Browse Atoms ({atomStats.withStories})
            </a>
            <a href="?path=/docs/molecules-messagebubble--docs" className="text-blue-600 hover:underline">
              🧬 Browse Molecules ({moleculeStats.withStories})
            </a>
            <a href="?path=/docs/organisms-sidebar--docs" className="text-blue-600 hover:underline">
              🦠 Browse Organisms ({organismStats.withStories})
            </a>
            <a href="?path=/docs/design-system-overview--docs" className="text-blue-600 hover:underline">
              📚 Full Documentation
            </a>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Complete overview of the Lace Design System with component counts, status, and navigation. Now includes all priority organisms with comprehensive stories.',
      },
    },
  },
};