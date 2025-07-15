import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faPlus, faCog, faTerminal, faCheckCircle, faInfoCircle } from '~/lib/fontawesome';
import { DesignSystemClient } from '~/components/admin/design/DesignSystemClient';

interface AtomicLevel {
  id: string;
  name: string;
  description: string;
  examples: string[];
  status: 'complete' | 'partial' | 'planned';
  count: number;
}

const atomicLevels: AtomicLevel[] = [
  {
    id: 'atoms',
    name: 'Atoms',
    description:
      "Basic building blocks - the fundamental elements that can't be broken down further without losing meaning.",
    examples: [
      'Design tokens (colors, spacing, typography)',
      'Buttons',
      'Icons',
      'Form inputs',
      'Labels',
    ],
    status: 'partial',
    count: 5,
  },
  {
    id: 'molecules',
    name: 'Molecules',
    description:
      'Simple groups of atoms functioning together as a unit with a single responsibility.',
    examples: [
      'Search form (input + button)',
      'Navigation item (icon + label)',
      'Message bubble (avatar + content)',
      'Card (header + body + actions)',
    ],
    status: 'partial',
    count: 8,
  },
  {
    id: 'organisms',
    name: 'Organisms',
    description:
      'Complex components composed of molecules and/or atoms that form distinct sections of an interface.',
    examples: [
      'Timeline view',
      'Sidebar navigation',
      'Modal dialogs',
      'Header with actions',
      'Command palette',
    ],
    status: 'partial',
    count: 15,
  },
  {
    id: 'templates',
    name: 'Templates',
    description:
      "Page-level objects that place components into a layout and articulate the design's underlying content structure.",
    examples: ['Main app layout', 'Modal layout', 'Mobile responsive patterns', 'Grid systems'],
    status: 'planned',
    count: 0,
  },
  {
    id: 'pages',
    name: 'Pages',
    description: 'Specific instances of templates with real representative content.',
    examples: ['Chat interface', 'Admin dashboard', 'Design system showcase', 'Settings panel'],
    status: 'complete',
    count: 3,
  },
];

interface DesignPrinciple {
  title: string;
  description: string;
  implementation: string;
  icon: any;
}

const designPrinciples: DesignPrinciple[] = [
  {
    title: "YAGNI (You Aren't Gonna Need It)",
    description: 'Build only what we need for current functionality and backend integration.',
    implementation: 'Every component maps to a real backend requirement or user story.',
    icon: faSearch,
  },
  {
    title: 'Lego-Style Composition',
    description:
      'Build complex components by composing simpler ones rather than creating monolithic components.',
    implementation: 'Molecules are built from atoms, organisms from molecules, etc.',
    icon: faPlus,
  },
  {
    title: 'Design Tokens First',
    description:
      'Establish foundational design decisions as reusable tokens before building components.',
    implementation: 'DaisyUI semantic tokens + custom spacing, typography, and animation scales.',
    icon: faCog,
  },
  {
    title: 'Mobile-First Responsive',
    description: 'Design for mobile constraints first, then enhance for larger screens.',
    implementation: 'Touch targets, overlay patterns, progressive enhancement.',
    icon: faTerminal,
  },
  {
    title: 'Accessibility by Default',
    description: 'Build inclusive interfaces from the ground up, not as an afterthought.',
    implementation: 'Semantic HTML, ARIA labels, keyboard navigation, color contrast.',
    icon: faCheckCircle,
  },
];

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
          <h1 className="text-4xl font-bold text-base-content mb-4">Lace Atomic Design System</h1>
          <p className="text-base-content/80 text-lg mb-6">
            A composable design system built on atomic design principles. Our components are the
            fundamental building blocks (Legos) that combine to create powerful, consistent
            interfaces.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3">Atomic Design Methodology</h3>
              <p className="text-base-content/70 text-sm mb-3">
                Inspired by Brad Frost's Atomic Design, we break down our interface into five
                distinct levels, from simple to complex.
              </p>
              <div className="flex flex-wrap gap-2">
                <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                  Atoms → Molecules → Organisms → Templates → Pages
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-base-content mb-3">Our Foundation</h3>
              <div className="space-y-2 text-sm text-base-content/70">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                  <span>DaisyUI + Tailwind CSS for design tokens</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-secondary rounded-full"></div>
                  <span>Framer Motion for animations</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-accent rounded-full"></div>
                  <span>TypeScript for type safety</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-info rounded-full"></div>
                  <span>React + Next.js for components</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Design Principles - Prominent Section */}
        <div className="bg-gradient-to-br from-teal-50 to-teal-100/50 rounded-lg shadow-sm border border-teal-200 p-8">
          <h2 className="text-3xl font-bold text-teal-900 mb-2">Core Design Principles</h2>
          <p className="text-teal-700 mb-6">
            These principles guide every design decision in our system
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {designPrinciples.map((principle, index) => (
              <div
                key={index}
                className="bg-white rounded-lg p-5 shadow-sm border border-teal-100 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-3">
                  <FontAwesomeIcon icon={principle.icon} className="w-5 h-5 text-teal-600" />
                  <h3 className="font-bold text-lg text-teal-800">{principle.title}</h3>
                </div>
                <p className="text-sm text-gray-700 mb-4">{principle.description}</p>
                <div className="text-xs text-teal-700 bg-teal-50 rounded-lg p-3 border border-teal-100">
                  <strong className="text-teal-800">How we apply it:</strong>
                  <div className="mt-1">{principle.implementation}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-teal-600 text-white rounded-lg">
            <div className="flex items-center gap-3">
              <FontAwesomeIcon icon={faInfoCircle} className="w-6 h-6 text-teal-100" />
              <div>
                <h4 className="font-bold">Remember:</h4>
                <p className="text-sm opacity-90">
                  Every component should be a reusable "Lego block" that follows these principles
                </p>
              </div>
            </div>
          </div>
        </div>

        <DesignSystemClient
          atomicLevels={atomicLevels}
          designPrinciples={designPrinciples}
        />

        {/* Quick Navigation */}
        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Quick Navigation</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {atomicLevels.map((level) => (
              <Link
                key={level.id}
                href={`/admin/design/${level.id}`}
                className="flex flex-col items-center p-4 border border-base-300 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors group"
              >
                <div className="w-10 h-10 bg-primary/10 group-hover:bg-primary/20 text-primary rounded-full flex items-center justify-center font-bold mb-2">
                  {level.name[0]}
                </div>
                <span className="font-medium text-base-content group-hover:text-primary transition-colors">
                  {level.name}
                </span>
                <span className="text-xs text-base-content/60 mt-1">{level.count} items</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
