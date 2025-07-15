import Link from 'next/link';
import { ComponentsClient } from '~/components/admin/design/ComponentsClient';

export default function ComponentsPage() {
  const componentStats = {
    atoms: 5,
    molecules: 8,
    organisms: 15,
    templates: 0,
    pages: 3
  };

  const recentImplementations = [
    { name: 'Timeline Carousel System', type: 'Organism', status: 'implemented', priority: 'high' },
    { name: 'Voice Recognition UI', type: 'Molecule', status: 'implemented', priority: 'medium' },
    { name: 'File Attachment System', type: 'Organism', status: 'implemented', priority: 'high' },
    { name: 'Modal System', type: 'Organism', status: 'implemented', priority: 'medium' },
    { name: 'Enhanced Chat Input', type: 'Organism', status: 'implemented', priority: 'high' },
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Component Overview</h1>
          <p className="text-base-content/70 mb-4">
            Our feature-rich component system organized by domain (timeline/, chat/, ui/) with atomic design principles for clear composition and hierarchy.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/admin/design" className="btn btn-primary btn-sm">
              View Full Design System
            </Link>
            <div className="text-sm text-base-content/60">
              Total: {Object.values(componentStats).reduce((a, b) => a + b, 0)} components across 5 levels
            </div>
          </div>
        </div>

        {/* Domain Organization Info */}
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-teal-800 mb-3">📁 Smart Organization Approach</h2>
          <p className="text-teal-700 mb-4">
            We organize components by <strong>domain</strong> for developer experience while documenting 
            <strong> atomic complexity</strong> for design system clarity.
          </p>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="bg-base-100 p-3 rounded border border-teal-200">
              <strong className="text-teal-600">ui/</strong> - Foundational components (atoms & molecules)
            </div>
            <div className="bg-base-100 p-3 rounded border border-teal-200">
              <strong className="text-teal-600">timeline/</strong> - Content display organisms  
            </div>
            <div className="bg-base-100 p-3 rounded border border-teal-200">
              <strong className="text-teal-600">chat/</strong> - Conversational interface organisms
            </div>
          </div>
        </div>

        {/* Component Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(componentStats).map(([level, count]) => (
            <Link
              key={level}
              href={`/admin/design/${level}`}
              className={`bg-base-100 border border-base-300 rounded-lg p-4 hover:border-teal-400 hover:bg-teal-50 transition-colors group ${count === 0 ? 'opacity-50' : ''}`}
            >
              <div className="text-center">
                <div className="text-2xl font-bold text-base-content group-hover:text-teal-700 transition-colors">
                  {count}
                </div>
                <div className="font-medium capitalize">{level}</div>
                <div className="text-xs text-base-content/60 mt-1">
                  {level === 'atoms' && '🟢 Single-purpose'}
                  {level === 'molecules' && '🔵 Simple compositions'}
                  {level === 'organisms' && '🟡 Complex sections'}
                  {level === 'templates' && '🟣 Need to create'}
                  {level === 'pages' && '🔴 Complete experiences'}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Access to Atomic Levels */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Atomic Design Levels</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            <Link href="/admin/design/atoms" className="border border-base-300 rounded-lg p-4 hover:border-primary hover:bg-primary/5 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-primary/10 group-hover:bg-primary/20 text-primary rounded-full flex items-center justify-center font-bold">
                  A
                </div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">Atoms</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-3">
                Design tokens, buttons, icons, form inputs, and basic building blocks
              </p>
              <div className="flex items-center gap-2">
                <div className="badge badge-success badge-sm">5 components</div>
                <div className="badge badge-outline badge-sm">Foundation</div>
              </div>
            </Link>

            <Link href="/admin/design/molecules" className="border border-base-300 rounded-lg p-4 hover:border-secondary hover:bg-secondary/5 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-secondary/10 group-hover:bg-secondary/20 text-secondary rounded-full flex items-center justify-center font-bold">
                  M
                </div>
                <h3 className="font-semibold group-hover:text-secondary transition-colors">Molecules</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-3">
                Search bars, navigation items, message bubbles, and functional combinations
              </p>
              <div className="flex items-center gap-2">
                <div className="badge badge-success badge-sm">8 components</div>
                <div className="badge badge-outline badge-sm">Functional</div>
              </div>
            </Link>

            <Link href="/admin/design/organisms" className="border border-base-300 rounded-lg p-4 hover:border-accent hover:bg-accent/5 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-accent/10 group-hover:bg-accent/20 text-accent rounded-full flex items-center justify-center font-bold">
                  O
                </div>
                <h3 className="font-semibold group-hover:text-accent transition-colors">Organisms</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-3">
                Timeline views, sidebar navigation, modals, and complete interface sections
              </p>
              <div className="flex items-center gap-2">
                <div className="badge badge-success badge-sm">15+ components</div>
                <div className="badge badge-outline badge-sm">Complex</div>
              </div>
            </Link>

          </div>
        </div>

        <ComponentsClient 
          componentStats={componentStats}
          recentImplementations={recentImplementations}
        />

        {/* Next Steps */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Development Roadmap</h2>
          <div className="grid md:grid-cols-3 gap-6">
            
            <div className="border border-base-300 rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-success rounded-full"></div>
                <h3 className="font-semibold">Current Sprint</h3>
              </div>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Atomic design foundation</li>
                <li>• Core atom library</li>
                <li>• Design token system</li>
                <li>• Component documentation</li>
              </ul>
            </div>

            <div className="border border-base-300 rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-warning rounded-full"></div>
                <h3 className="font-semibold">Next Sprint</h3>
              </div>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Molecule composition</li>
                <li>• Carousel components</li>
                <li>• Modal system organisms</li>
                <li>• Enhanced interactions</li>
              </ul>
            </div>

            <div className="border border-base-300 rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-info rounded-full"></div>
                <h3 className="font-semibold">Future</h3>
              </div>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Template systems</li>
                <li>• Advanced animations</li>
                <li>• Integration components</li>
                <li>• Performance optimization</li>
              </ul>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}