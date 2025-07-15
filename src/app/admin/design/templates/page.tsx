'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks, faUser, faRobot, faCog } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';

export default function TemplatesPage() {
  const [activeTab, setActiveTab] = useState('layouts');
  const [selectedTemplate, setSelectedTemplate] = useState('main-app');

  const layoutTemplates = [
    {
      id: 'main-app',
      name: 'Main Application Layout',
      description: 'Primary layout with sidebar, header, and main content area',
      responsive: true,
      components: ['Sidebar', 'Header', 'Main Content', 'Footer']
    },
    {
      id: 'modal-layout',
      name: 'Modal Layout',
      description: 'Overlay layout for dialogs and modal content',
      responsive: true,
      components: ['Backdrop', 'Modal Container', 'Modal Content']
    },
    {
      id: 'dashboard',
      name: 'Dashboard Layout',
      description: 'Grid-based layout for data visualization and metrics',
      responsive: true,
      components: ['Metric Cards', 'Charts', 'Data Tables', 'Filters']
    },
    {
      id: 'mobile-first',
      name: 'Mobile-First Layout',
      description: 'Touch-optimized layout with overlay navigation',
      responsive: true,
      components: ['Mobile Header', 'Overlay Menu', 'Touch Navigation']
    }
  ];

  const gridSystems = [
    { name: '12-Column Grid', cols: 12, usage: 'Standard web layouts' },
    { name: '16-Column Grid', cols: 16, usage: 'Complex dashboards' },
    { name: 'Flexbox Layout', cols: 'auto', usage: 'Dynamic content' },
    { name: 'CSS Grid', cols: 'custom', usage: 'Complex layouts' }
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Templates</h1>
          <p className="text-base-content/70 mb-4">
            Page-level objects that place components into a layout and articulate the design's underlying content structure. Templates focus on layout patterns without specific content.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-info rounded-full"></div>
            <span>Layout patterns • Structure definition • Responsive behavior</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-base-100 rounded-lg border border-base-300">
          <div className="flex border-b border-base-300 overflow-x-auto">
            {[
              { id: 'layouts', label: 'Layout Templates', desc: 'Application structures' },
              { id: 'grids', label: 'Grid Systems', desc: 'Content organization' },
              { id: 'responsive', label: 'Responsive Patterns', desc: 'Breakpoint behaviors' },
              { id: 'compositions', label: 'Compositions', desc: 'Component arrangements' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-32 p-4 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-info/10 text-info border-b-2 border-info'
                    : 'hover:bg-base-200'
                }`}
              >
                <div className="font-medium text-sm">{tab.label}</div>
                <div className="text-xs text-base-content/60">{tab.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            
            {/* Layout Templates */}
            {activeTab === 'layouts' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Application Layouts</h3>
                  
                  <div className="grid md:grid-cols-2 gap-4 mb-6">
                    {layoutTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => setSelectedTemplate(template.id)}
                        className={`p-4 border rounded-lg text-left transition-colors ${
                          selectedTemplate === template.id
                            ? 'border-info bg-info/10'
                            : 'border-base-300 hover:border-base-content/20'
                        }`}
                      >
                        <div className="font-semibold mb-2">{template.name}</div>
                        <div className="text-sm text-base-content/70 mb-3">{template.description}</div>
                        <div className="flex items-center gap-2">
                          {template.responsive && (
                            <div className="badge badge-success badge-sm">Responsive</div>
                          )}
                          <div className="badge badge-outline badge-sm">{template.components.length} components</div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Template Preview */}
                  <div className="border border-base-300 rounded-lg overflow-hidden bg-white">
                    <div className="p-4 border-b border-base-300 bg-base-100">
                      <h4 className="font-semibold">
                        {layoutTemplates.find(t => t.id === selectedTemplate)?.name} Preview
                      </h4>
                    </div>
                    
                    {selectedTemplate === 'main-app' && (
                      <div className="h-96 flex">
                        {/* Sidebar */}
                        <div className="w-64 bg-base-100 border-r border-base-300 p-4">
                          <div className="space-y-2">
                            <div className="h-8 bg-primary/20 rounded flex items-center px-3">
                              <div className="w-4 h-4 bg-primary/40 rounded mr-2"></div>
                              <div className="h-3 bg-primary/60 rounded flex-1"></div>
                            </div>
                            <div className="h-8 bg-base-200 rounded flex items-center px-3">
                              <div className="w-4 h-4 bg-base-300 rounded mr-2"></div>
                              <div className="h-3 bg-base-300 rounded flex-1"></div>
                            </div>
                            <div className="h-8 bg-base-200 rounded flex items-center px-3">
                              <div className="w-4 h-4 bg-base-300 rounded mr-2"></div>
                              <div className="h-3 bg-base-300 rounded flex-1"></div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Main Content */}
                        <div className="flex-1 flex flex-col">
                          {/* Header */}
                          <div className="h-16 bg-base-100 border-b border-base-300 flex items-center px-6">
                            <div className="h-6 bg-base-300 rounded w-48"></div>
                            <div className="ml-auto h-8 w-8 bg-base-300 rounded-full"></div>
                          </div>
                          
                          {/* Content Area */}
                          <div className="flex-1 p-6 bg-base-50">
                            <div className="space-y-4">
                              <div className="h-4 bg-base-300 rounded w-3/4"></div>
                              <div className="h-32 bg-base-200 rounded"></div>
                              <div className="h-4 bg-base-300 rounded w-1/2"></div>
                              <div className="h-24 bg-base-200 rounded"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedTemplate === 'modal-layout' && (
                      <div className="h-96 bg-base-200 relative flex items-center justify-center">
                        <div className="absolute inset-0 bg-black/20"></div>
                        <div className="relative bg-base-100 rounded-lg border border-base-300 w-80 p-6">
                          <div className="flex items-center justify-between mb-4">
                            <div className="h-6 bg-base-300 rounded w-32"></div>
                            <div className="w-6 h-6 bg-base-300 rounded"></div>
                          </div>
                          <div className="space-y-3">
                            <div className="h-4 bg-base-200 rounded"></div>
                            <div className="h-4 bg-base-200 rounded w-3/4"></div>
                            <div className="h-16 bg-base-200 rounded"></div>
                            <div className="flex gap-2 justify-end pt-4">
                              <div className="h-8 bg-base-300 rounded w-16"></div>
                              <div className="h-8 bg-primary/60 rounded w-16"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedTemplate === 'dashboard' && (
                      <div className="h-96 p-6 bg-base-50">
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <div className="bg-base-100 rounded p-4 border border-base-300">
                            <div className="h-4 bg-base-300 rounded w-20 mb-2"></div>
                            <div className="h-8 bg-primary/20 rounded w-16"></div>
                          </div>
                          <div className="bg-base-100 rounded p-4 border border-base-300">
                            <div className="h-4 bg-base-300 rounded w-20 mb-2"></div>
                            <div className="h-8 bg-secondary/20 rounded w-16"></div>
                          </div>
                          <div className="bg-base-100 rounded p-4 border border-base-300">
                            <div className="h-4 bg-base-300 rounded w-20 mb-2"></div>
                            <div className="h-8 bg-accent/20 rounded w-16"></div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-base-100 rounded p-4 border border-base-300">
                            <div className="h-32 bg-base-200 rounded"></div>
                          </div>
                          <div className="bg-base-100 rounded p-4 border border-base-300">
                            <div className="space-y-2">
                              <div className="h-4 bg-base-200 rounded"></div>
                              <div className="h-4 bg-base-200 rounded w-3/4"></div>
                              <div className="h-4 bg-base-200 rounded w-1/2"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedTemplate === 'mobile-first' && (
                      <div className="h-96 bg-base-50 max-w-sm mx-auto border-x border-base-300">
                        {/* Mobile Header */}
                        <div className="h-16 bg-base-100 border-b border-base-300 flex items-center px-4">
                          <div className="w-6 h-6 bg-base-300 rounded mr-3"></div>
                          <div className="h-6 bg-base-300 rounded flex-1 max-w-24"></div>
                          <div className="w-8 h-8 bg-base-300 rounded-full ml-auto"></div>
                        </div>
                        
                        {/* Mobile Content */}
                        <div className="p-4 space-y-4">
                          <div className="h-4 bg-base-300 rounded w-3/4"></div>
                          <div className="h-24 bg-base-200 rounded"></div>
                          <div className="h-4 bg-base-300 rounded w-1/2"></div>
                          <div className="h-20 bg-base-200 rounded"></div>
                        </div>
                        
                        {/* Mobile Bottom Navigation */}
                        <div className="absolute bottom-0 left-0 right-0 h-16 bg-base-100 border-t border-base-300 flex items-center justify-around px-4">
                          <div className="w-6 h-6 bg-primary/60 rounded"></div>
                          <div className="w-6 h-6 bg-base-300 rounded"></div>
                          <div className="w-6 h-6 bg-base-300 rounded"></div>
                          <div className="w-6 h-6 bg-base-300 rounded"></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* Grid Systems */}
            {activeTab === 'grids' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Grid System Options</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6 mb-8">
                    {gridSystems.map((grid, index) => (
                      <div key={index} className="border border-base-300 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-semibold">{grid.name}</h4>
                          <div className="badge badge-outline">{grid.cols} columns</div>
                        </div>
                        <p className="text-sm text-base-content/70">{grid.usage}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <h4 className="font-semibold mb-4">12-Column Grid Example</h4>
                    <div className="border border-base-300 rounded-lg p-6 bg-base-100">
                      <div className="grid grid-cols-12 gap-2 mb-4">
                        {Array.from({ length: 12 }, (_, i) => (
                          <div key={i} className="h-8 bg-primary/20 rounded flex items-center justify-center text-xs">
                            {i + 1}
                          </div>
                        ))}
                      </div>
                      
                      <div className="space-y-2">
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-6 h-12 bg-secondary/20 rounded flex items-center justify-center text-sm">
                            col-span-6
                          </div>
                          <div className="col-span-6 h-12 bg-secondary/20 rounded flex items-center justify-center text-sm">
                            col-span-6
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-4 h-12 bg-accent/20 rounded flex items-center justify-center text-sm">
                            col-span-4
                          </div>
                          <div className="col-span-8 h-12 bg-accent/20 rounded flex items-center justify-center text-sm">
                            col-span-8
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-3 h-12 bg-info/20 rounded flex items-center justify-center text-sm">
                            col-span-3
                          </div>
                          <div className="col-span-3 h-12 bg-info/20 rounded flex items-center justify-center text-sm">
                            col-span-3
                          </div>
                          <div className="col-span-3 h-12 bg-info/20 rounded flex items-center justify-center text-sm">
                            col-span-3
                          </div>
                          <div className="col-span-3 h-12 bg-info/20 rounded flex items-center justify-center text-sm">
                            col-span-3
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Responsive Patterns */}
            {activeTab === 'responsive' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Breakpoint System</h3>
                  
                  <div className="overflow-x-auto">
                    <table className="table table-zebra w-full">
                      <thead>
                        <tr>
                          <th>Breakpoint</th>
                          <th>Size</th>
                          <th>Tailwind Class</th>
                          <th>Usage</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="font-medium">Mobile</td>
                          <td>0px - 639px</td>
                          <td><code className="bg-base-200 px-2 py-1 rounded text-xs">default</code></td>
                          <td>Single column, stack layouts</td>
                        </tr>
                        <tr>
                          <td className="font-medium">Tablet</td>
                          <td>640px - 767px</td>
                          <td><code className="bg-base-200 px-2 py-1 rounded text-xs">sm:</code></td>
                          <td>Simplified 2-column layouts</td>
                        </tr>
                        <tr>
                          <td className="font-medium">Desktop</td>
                          <td>768px - 1023px</td>
                          <td><code className="bg-base-200 px-2 py-1 rounded text-xs">md:</code></td>
                          <td>Multi-column layouts, sidebar</td>
                        </tr>
                        <tr>
                          <td className="font-medium">Large Desktop</td>
                          <td>1024px - 1279px</td>
                          <td><code className="bg-base-200 px-2 py-1 rounded text-xs">lg:</code></td>
                          <td>Expanded layouts, more content</td>
                        </tr>
                        <tr>
                          <td className="font-medium">XL Desktop</td>
                          <td>1280px+</td>
                          <td><code className="bg-base-200 px-2 py-1 rounded text-xs">xl:</code></td>
                          <td>Maximum content width</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Responsive Layout Patterns</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Sidebar Collapse</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-primary rounded-full"></div>
                          <span><strong>Mobile:</strong> Overlay sidebar</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-secondary rounded-full"></div>
                          <span><strong>Tablet:</strong> Collapsed sidebar (icons only)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-accent rounded-full"></div>
                          <span><strong>Desktop:</strong> Full sidebar with labels</span>
                        </div>
                      </div>
                    </div>

                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Content Stacking</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-primary rounded-full"></div>
                          <span><strong>Mobile:</strong> Single column stack</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-secondary rounded-full"></div>
                          <span><strong>Tablet:</strong> 2-column grid</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-accent rounded-full"></div>
                          <span><strong>Desktop:</strong> 3+ column grid</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Touch Optimization</h3>
                  
                  <div className="border border-base-300 rounded-lg p-6 bg-base-100">
                    <div className="grid md:grid-cols-3 gap-6">
                      <div>
                        <h4 className="font-semibold mb-3">Touch Targets</h4>
                        <div className="space-y-2 text-sm">
                          <div>• Minimum 44px × 44px</div>
                          <div>• 8px spacing between targets</div>
                          <div>• Larger targets for primary actions</div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-3">Gesture Support</h4>
                        <div className="space-y-2 text-sm">
                          <div>• Swipe navigation</div>
                          <div>• Pull-to-refresh</div>
                          <div>• Pinch-to-zoom where appropriate</div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-3">Performance</h4>
                        <div className="space-y-2 text-sm">
                          <div>• Smooth 60fps animations</div>
                          <div>• Optimized images</div>
                          <div>• Progressive loading</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Compositions */}
            {activeTab === 'compositions' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Component Arrangements</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Header + Content + Footer</h4>
                      <div className="border border-base-300 rounded bg-base-50 h-48">
                        <div className="h-12 bg-primary/20 border-b border-base-300 flex items-center px-3">
                          <div className="text-xs">Header Area</div>
                        </div>
                        <div className="flex-1 p-3 h-24">
                          <div className="text-xs text-base-content/60">Main Content Area</div>
                          <div className="h-16 bg-base-200 rounded mt-2"></div>
                        </div>
                        <div className="h-8 bg-base-300/50 border-t border-base-300 flex items-center px-3">
                          <div className="text-xs">Footer</div>
                        </div>
                      </div>
                    </div>

                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Sidebar + Main</h4>
                      <div className="border border-base-300 rounded bg-base-50 h-48 flex">
                        <div className="w-16 bg-secondary/20 border-r border-base-300 p-2">
                          <div className="text-xs">Sidebar</div>
                        </div>
                        <div className="flex-1 p-3">
                          <div className="text-xs text-base-content/60">Main Content</div>
                          <div className="h-32 bg-base-200 rounded mt-2"></div>
                        </div>
                      </div>
                    </div>

                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Split View</h4>
                      <div className="border border-base-300 rounded bg-base-50 h-48 flex">
                        <div className="flex-1 bg-accent/20 border-r border-base-300 p-3">
                          <div className="text-xs">Left Panel</div>
                          <div className="h-32 bg-base-200 rounded mt-2"></div>
                        </div>
                        <div className="flex-1 p-3">
                          <div className="text-xs text-base-content/60">Right Panel</div>
                          <div className="h-32 bg-base-200 rounded mt-2"></div>
                        </div>
                      </div>
                    </div>

                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Grid Layout</h4>
                      <div className="border border-base-300 rounded bg-base-50 h-48 p-3">
                        <div className="grid grid-cols-2 gap-2 h-full">
                          <div className="bg-info/20 rounded p-2">
                            <div className="text-xs">Item 1</div>
                          </div>
                          <div className="bg-info/20 rounded p-2">
                            <div className="text-xs">Item 2</div>
                          </div>
                          <div className="bg-info/20 rounded p-2">
                            <div className="text-xs">Item 3</div>
                          </div>
                          <div className="bg-info/20 rounded p-2">
                            <div className="text-xs">Item 4</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Layout Composition Rules</h3>
                  
                  <div className="border border-base-300 rounded-lg p-6 bg-base-100">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-3">Spacing & Rhythm</h4>
                        <div className="space-y-2 text-sm text-base-content/80">
                          <div>• Use consistent spacing scale (4px, 8px, 16px, 24px, 32px)</div>
                          <div>• Maintain vertical rhythm with baseline grid</div>
                          <div>• Group related content with closer spacing</div>
                          <div>• Separate sections with appropriate whitespace</div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-3">Hierarchy & Focus</h4>
                        <div className="space-y-2 text-sm text-base-content/80">
                          <div>• Primary content gets most visual weight</div>
                          <div>• Secondary content uses subtle backgrounds</div>
                          <div>• Navigation should be consistent and predictable</div>
                          <div>• Clear visual hierarchy guides user attention</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

        {/* Template Guidelines */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Template Design Principles</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-success">✓ Effective Templates</h3>
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
              <h3 className="font-semibold text-base-content mb-3 text-error">✗ Poor Template Design</h3>
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