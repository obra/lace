'use client';

import { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

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
    description: 'Basic building blocks - the fundamental elements that can\'t be broken down further without losing meaning.',
    examples: ['Design tokens (colors, spacing, typography)', 'Buttons', 'Icons', 'Form inputs', 'Labels'],
    status: 'partial',
    count: 12,
  },
  {
    id: 'molecules',
    name: 'Molecules',
    description: 'Simple groups of atoms functioning together as a unit with a single responsibility.',
    examples: ['Search form (input + button)', 'Navigation item (icon + label)', 'Message bubble (avatar + content)', 'Card (header + body + actions)'],
    status: 'partial',
    count: 8,
  },
  {
    id: 'organisms',
    name: 'Organisms',
    description: 'Complex components composed of molecules and/or atoms that form distinct sections of an interface.',
    examples: ['Timeline view', 'Sidebar navigation', 'Modal dialogs', 'Header with actions', 'Command palette'],
    status: 'partial',
    count: 6,
  },
  {
    id: 'templates',
    name: 'Templates',
    description: 'Page-level objects that place components into a layout and articulate the design\'s underlying content structure.',
    examples: ['Main app layout', 'Modal layout', 'Mobile responsive patterns', 'Grid systems'],
    status: 'partial',
    count: 4,
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
}

const designPrinciples: DesignPrinciple[] = [
  {
    title: 'YAGNI (You Aren\'t Gonna Need It)',
    description: 'Build only what we need for current functionality and backend integration.',
    implementation: 'Every component maps to a real backend requirement or user story.'
  },
  {
    title: 'Composition over Inheritance',
    description: 'Build complex components by composing simpler ones rather than creating monolithic components.',
    implementation: 'Molecules are built from atoms, organisms from molecules, etc.'
  },
  {
    title: 'Design Tokens First',
    description: 'Establish foundational design decisions as reusable tokens before building components.',
    implementation: 'DaisyUI semantic tokens + custom spacing, typography, and animation scales.'
  },
  {
    title: 'Mobile-First Responsive',
    description: 'Design for mobile constraints first, then enhance for larger screens.',
    implementation: 'Touch targets, overlay patterns, progressive enhancement.'
  },
  {
    title: 'Accessibility by Default',
    description: 'Build inclusive interfaces from the ground up, not as an afterthought.',
    implementation: 'Semantic HTML, ARIA labels, keyboard navigation, color contrast.'
  },
];

export default function DesignSystemPage() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['atoms']));

  const toggleSection = (id: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSections(newExpanded);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-success/20 text-success border-success/30';
      case 'partial':
        return 'bg-warning/20 text-warning border-warning/30';
      case 'planned':
        return 'bg-info/20 text-info border-info/30';
      default:
        return 'bg-base-300/20 text-base-content border-base-300';
    }
  };

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
          <h1 className="text-4xl font-bold text-base-content mb-4">
            Lace Atomic Design System
          </h1>
          <p className="text-base-content/80 text-lg mb-6">
            A composable design system built on atomic design principles. Our components are the fundamental building blocks (Legos) that combine to create powerful, consistent interfaces.
          </p>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3">Atomic Design Methodology</h3>
              <p className="text-base-content/70 text-sm mb-3">
                Inspired by Brad Frost's Atomic Design, we break down our interface into five distinct levels, from simple to complex.
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

        {/* Design Principles */}
        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
          <h2 className="text-2xl font-bold text-base-content mb-4">Design Principles</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {designPrinciples.map((principle, index) => (
              <div key={index} className="border border-base-300 rounded-lg p-4">
                <h3 className="font-semibold text-base-content mb-2">{principle.title}</h3>
                <p className="text-sm text-base-content/70 mb-3">{principle.description}</p>
                <div className="text-xs text-base-content/60 bg-base-200 rounded p-2">
                  <strong>Implementation:</strong> {principle.implementation}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Atomic Levels */}
        <div className="space-y-4">
          {atomicLevels.map((level, index) => (
            <div
              key={level.id}
              className="bg-base-100 rounded-lg border border-base-300 overflow-hidden"
            >
              <button
                onClick={() => toggleSection(level.id)}
                className="w-full p-6 text-left hover:bg-base-200/50 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold text-sm">
                      {index + 1}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-base-content">{level.name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(level.status)}`}>
                          {level.status}
                        </span>
                        <span className="text-sm text-base-content/60">
                          {level.count} components
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Link 
                    href={`/admin/design/${level.id}`}
                    className="btn btn-sm btn-outline btn-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View {level.name}
                  </Link>
                  {expandedSections.has(level.id) ? (
                    <ChevronDownIcon className="w-5 h-5 text-base-content/60" />
                  ) : (
                    <ChevronRightIcon className="w-5 h-5 text-base-content/60" />
                  )}
                </div>
              </button>

              {expandedSections.has(level.id) && (
                <div className="px-6 pb-6 border-t border-base-300">
                  <div className="pt-4">
                    <p className="text-base-content/80 mb-4">{level.description}</p>
                    
                    <div>
                      <h4 className="font-medium text-base-content mb-3">Examples in this level:</h4>
                      <div className="grid md:grid-cols-2 gap-2">
                        {level.examples.map((example, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-base-content/70">
                            <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                            <span>{example}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 p-3 bg-base-200 rounded-lg">
                      <div className="text-xs text-base-content/60 uppercase tracking-wide font-medium mb-1">
                        Component Philosophy
                      </div>
                      <div className="text-sm text-base-content/80">
                        {level.id === 'atoms' && "Single-purpose, highly reusable. These are the core building blocks that everything else is built from."}
                        {level.id === 'molecules' && "Simple combinations that solve specific UI patterns. Each molecule has one clear responsibility."}
                        {level.id === 'organisms' && "Complex, standalone sections that could exist independently. Often contain business logic."}
                        {level.id === 'templates' && "Layout patterns that define structure without content. Focus on responsive behavior and composition."}
                        {level.id === 'pages' && "Complete user experiences with real content and full functionality."}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

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
                <span className="text-xs text-base-content/60 mt-1">
                  {level.count} items
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Implementation Status */}
        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Implementation Roadmap</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-success rounded-full"></div>
              <span className="font-medium">Current Sprint:</span>
              <span className="text-base-content/70">Atomic design foundation + core atoms</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-warning rounded-full"></div>
              <span className="font-medium">Next Sprint:</span>
              <span className="text-base-content/70">Molecule composition + carousel organisms</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-info rounded-full"></div>
              <span className="font-medium">Future:</span>
              <span className="text-base-content/70">Template systems + advanced interactions</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}