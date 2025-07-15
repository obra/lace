import { TemplatesClient } from '~/components/admin/design/TemplatesClient';

export default function TemplatesPage() {
  const layoutTemplates = [
    {
      id: 'main-app',
      name: 'Main Application Layout',
      description: 'Primary layout with sidebar, header, and main content area',
      responsive: true,
      components: ['Sidebar', 'Header', 'Main Content', 'Footer'],
    },
    {
      id: 'modal-layout',
      name: 'Modal Layout',
      description: 'Overlay layout for dialogs and modal content',
      responsive: true,
      components: ['Backdrop', 'Modal Container', 'Modal Content'],
    },
    {
      id: 'dashboard',
      name: 'Dashboard Layout',
      description: 'Grid-based layout for data visualization and metrics',
      responsive: true,
      components: ['Metric Cards', 'Charts', 'Data Tables', 'Filters'],
    },
    {
      id: 'mobile-first',
      name: 'Mobile-First Layout',
      description: 'Touch-optimized layout with overlay navigation',
      responsive: true,
      components: ['Mobile Header', 'Overlay Menu', 'Touch Navigation'],
    },
  ];

  const gridSystems = [
    { name: '12-Column Grid', cols: 12, usage: 'Standard web layouts' },
    { name: '16-Column Grid', cols: 16, usage: 'Complex dashboards' },
    { name: 'Flexbox Layout', cols: 'auto', usage: 'Dynamic content' },
    { name: 'CSS Grid', cols: 'custom', usage: 'Complex layouts' },
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Templates</h1>
          <p className="text-base-content/70 mb-4">
            Page-level objects that place components into a layout and articulate the design's
            underlying content structure. Templates focus on layout patterns without specific
            content.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-info rounded-full"></div>
            <span>Layout patterns • Structure definition • Responsive behavior</span>
          </div>
        </div>

        <TemplatesClient layoutTemplates={layoutTemplates} gridSystems={gridSystems} />

        {/* Template Guidelines */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Template Design Principles</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-success mb-3">✓ Effective Templates</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Focus on structure, not specific content</li>
                <li>• Responsive by design across all breakpoints</li>
                <li>• Consistent spacing and grid systems</li>
                <li>• Clear content hierarchy and flow</li>
                <li>• Accessible navigation and interaction patterns</li>
                <li>• Performance-optimized layout strategies</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-error mb-3">✗ Poor Template Design</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Fixed layouts that don't adapt to content</li>
                <li>• Inconsistent spacing and alignment</li>
                <li>• Poor mobile/responsive behavior</li>
                <li>• Unclear content hierarchy</li>
                <li>• Complex layouts that are hard to maintain</li>
                <li>• Performance issues with layout shifts</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}