import Link from 'next/link';
import { PagesClient } from '~/components/admin/design/PagesClient';

export default function PagesPage() {

  const pageExamples = [
    {
      id: 'chat-interface',
      name: 'Chat Interface',
      description: 'Complete conversational AI interface with timeline, input, and tools',
      atoms: ['Buttons', 'Icons', 'Form inputs', 'Typography'],
      molecules: ['Search bar', 'Message bubble', 'Navigation item', 'Tool selector'],
      organisms: ['Timeline view', 'Sidebar navigation', 'Tool panel'],
      templates: ['Main app layout', 'Responsive patterns'],
      features: ['Real-time messaging', 'Tool integration', 'Voice input', 'Theme switching']
    },
    {
      id: 'admin-dashboard',
      name: 'Admin Dashboard',
      description: 'System administration interface with metrics, controls, and monitoring',
      atoms: ['Status badges', 'Metric cards', 'Toggle switches', 'Data tables'],
      molecules: ['Filter controls', 'Status indicators', 'Action buttons'],
      organisms: ['Metrics overview', 'Activity feed', 'Control panel'],
      templates: ['Dashboard layout', 'Grid system'],
      features: ['Real-time metrics', 'User management', 'System controls', 'Activity monitoring']
    },
    {
      id: 'design-system',
      name: 'Design System Showcase',
      description: 'Interactive documentation and examples of all design components',
      atoms: ['Color swatches', 'Typography samples', 'Icon library'],
      molecules: ['Code examples', 'Component previews', 'Usage guidelines'],
      organisms: ['Component browser', 'Documentation viewer', 'Interactive examples'],
      templates: ['Documentation layout', 'Tabbed interface'],
      features: ['Live examples', 'Code generation', 'Usage guidelines', 'Component search']
    },
    {
      id: 'settings-panel',
      name: 'Settings Panel',
      description: 'User preferences and system configuration interface',
      atoms: ['Form controls', 'Labels', 'Validation states'],
      molecules: ['Setting groups', 'Toggle controls', 'Selection lists'],
      organisms: ['Settings sections', 'Preference panels', 'Account management'],
      templates: ['Settings layout', 'Multi-column forms'],
      features: ['User preferences', 'Theme selection', 'API configuration', 'Account settings']
    }
  ];

  const implementationStages = [
    {
      stage: 'Planning',
      description: 'Define page purpose, user stories, and component requirements',
      tasks: ['User story mapping', 'Content audit', 'Component inventory', 'Information architecture']
    },
    {
      stage: 'Wireframing',
      description: 'Create low-fidelity layouts focusing on structure and flow',
      tasks: ['Template selection', 'Content organization', 'User flow mapping', 'Responsive planning']
    },
    {
      stage: 'Design',
      description: 'Apply design system components to create high-fidelity designs',
      tasks: ['Component selection', 'Visual hierarchy', 'Interaction design', 'Accessibility review']
    },
    {
      stage: 'Development',
      description: 'Build pages using atomic design components',
      tasks: ['Component composition', 'Data integration', 'State management', 'Performance optimization']
    },
    {
      stage: 'Testing',
      description: 'Validate functionality, usability, and performance',
      tasks: ['Component testing', 'Integration testing', 'Accessibility testing', 'Performance testing']
    }
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Pages</h1>
          <p className="text-base-content/70 mb-4">
            Specific instances of templates with real representative content. Pages demonstrate how atoms, molecules, organisms, and templates work together to create complete user experiences.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-success rounded-full"></div>
            <span>Complete experiences • Real content • Full functionality</span>
          </div>
        </div>

        <PagesClient 
          pageExamples={pageExamples}
          implementationStages={implementationStages}
        />

        {/* Summary */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Atomic Design Summary</h2>
          <div className="grid md:grid-cols-5 gap-4 text-center">
            <div className="p-4 border border-primary/30 rounded-lg bg-primary/5">
              <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="font-bold text-primary">A</span>
              </div>
              <h3 className="font-semibold mb-2">Atoms</h3>
              <p className="text-xs text-base-content/70">Basic building blocks</p>
            </div>
            <div className="p-4 border border-secondary/30 rounded-lg bg-secondary/5">
              <div className="w-12 h-12 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="font-bold text-secondary">M</span>
              </div>
              <h3 className="font-semibold mb-2">Molecules</h3>
              <p className="text-xs text-base-content/70">Simple combinations</p>
            </div>
            <div className="p-4 border border-accent/30 rounded-lg bg-accent/5">
              <div className="w-12 h-12 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="font-bold text-accent">O</span>
              </div>
              <h3 className="font-semibold mb-2">Organisms</h3>
              <p className="text-xs text-base-content/70">Complex sections</p>
            </div>
            <div className="p-4 border border-info/30 rounded-lg bg-info/5">
              <div className="w-12 h-12 bg-info/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="font-bold text-info">T</span>
              </div>
              <h3 className="font-semibold mb-2">Templates</h3>
              <p className="text-xs text-base-content/70">Layout patterns</p>
            </div>
            <div className="p-4 border border-success/30 rounded-lg bg-success/5">
              <div className="w-12 h-12 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="font-bold text-success">P</span>
              </div>
              <h3 className="font-semibold mb-2">Pages</h3>
              <p className="text-xs text-base-content/70">Complete experiences</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}