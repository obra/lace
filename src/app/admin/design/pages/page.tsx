'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks, faUser, faRobot, faCog, faPlus, faCheck, faStop } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';

export default function PagesPage() {
  const [activeTab, setActiveTab] = useState('examples');

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

  const [selectedPage, setSelectedPage] = useState('chat-interface');

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

        {/* Navigation Tabs */}
        <div className="bg-base-100 rounded-lg border border-base-300">
          <div className="flex border-b border-base-300 overflow-x-auto">
            {[
              { id: 'examples', label: 'Page Examples', desc: 'Complete implementations' },
              { id: 'composition', label: 'Composition', desc: 'How components combine' },
              { id: 'implementation', label: 'Implementation', desc: 'Development process' },
              { id: 'best-practices', label: 'Best Practices', desc: 'Guidelines & patterns' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-32 p-4 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-success/10 text-success border-b-2 border-success'
                    : 'hover:bg-base-200'
                }`}
              >
                <div className="font-medium text-sm">{tab.label}</div>
                <div className="text-xs text-base-content/60">{tab.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            
            {/* Page Examples */}
            {activeTab === 'examples' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Complete Page Examples</h3>
                  
                  <div className="grid md:grid-cols-2 gap-4 mb-6">
                    {pageExamples.map((page) => (
                      <button
                        key={page.id}
                        onClick={() => setSelectedPage(page.id)}
                        className={`p-4 border rounded-lg text-left transition-colors ${
                          selectedPage === page.id
                            ? 'border-success bg-success/10'
                            : 'border-base-300 hover:border-base-content/20'
                        }`}
                      >
                        <div className="font-semibold mb-2">{page.name}</div>
                        <div className="text-sm text-base-content/70 mb-3">{page.description}</div>
                        <div className="flex flex-wrap gap-1">
                          {page.features.slice(0, 3).map((feature, i) => (
                            <div key={i} className="badge badge-outline badge-sm">{feature}</div>
                          ))}
                          {page.features.length > 3 && (
                            <div className="badge badge-outline badge-sm">+{page.features.length - 3}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Page Breakdown */}
                  <div className="border border-base-300 rounded-lg bg-base-100">
                    <div className="p-4 border-b border-base-300">
                      <h4 className="font-semibold">
                        {pageExamples.find(p => p.id === selectedPage)?.name} - Component Breakdown
                      </h4>
                    </div>
                    
                    <div className="p-6">
                      {pageExamples.filter(p => p.id === selectedPage).map((page) => (
                        <div key={page.id} className="space-y-6">
                          
                          {/* Description */}
                          <p className="text-base-content/80">{page.description}</p>

                          {/* Atomic Breakdown */}
                          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="border border-base-300 rounded p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-3 h-3 bg-primary rounded-full"></div>
                                <h5 className="font-semibold">Atoms</h5>
                              </div>
                              <div className="space-y-1">
                                {page.atoms.map((atom, i) => (
                                  <div key={i} className="text-sm text-base-content/70">• {atom}</div>
                                ))}
                              </div>
                            </div>

                            <div className="border border-base-300 rounded p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-3 h-3 bg-secondary rounded-full"></div>
                                <h5 className="font-semibold">Molecules</h5>
                              </div>
                              <div className="space-y-1">
                                {page.molecules.map((molecule, i) => (
                                  <div key={i} className="text-sm text-base-content/70">• {molecule}</div>
                                ))}
                              </div>
                            </div>

                            <div className="border border-base-300 rounded p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-3 h-3 bg-accent rounded-full"></div>
                                <h5 className="font-semibold">Organisms</h5>
                              </div>
                              <div className="space-y-1">
                                {page.organisms.map((organism, i) => (
                                  <div key={i} className="text-sm text-base-content/70">• {organism}</div>
                                ))}
                              </div>
                            </div>

                            <div className="border border-base-300 rounded p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-3 h-3 bg-info rounded-full"></div>
                                <h5 className="font-semibold">Templates</h5>
                              </div>
                              <div className="space-y-1">
                                {page.templates.map((template, i) => (
                                  <div key={i} className="text-sm text-base-content/70">• {template}</div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Features */}
                          <div>
                            <h5 className="font-semibold mb-3">Key Features</h5>
                            <div className="grid md:grid-cols-2 gap-3">
                              {page.features.map((feature, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="w-2 h-2 bg-success rounded-full"></div>
                                  <span className="text-sm">{feature}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Composition */}
            {activeTab === 'composition' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Atomic Design Composition</h3>
                  
                  <div className="border border-base-300 rounded-lg p-6 bg-base-100">
                    <div className="text-center mb-6">
                      <h4 className="font-semibold mb-2">How Components Build Up</h4>
                      <p className="text-sm text-base-content/70">
                        Each level builds upon the previous, creating more complex and functional components
                      </p>
                    </div>

                    <div className="space-y-6">
                      {/* Visual Composition Flow */}
                      <div className="flex items-center justify-center">
                        <div className="flex items-center gap-4">
                          <div className="text-center">
                            <div className="w-12 h-12 bg-primary/20 border-2 border-primary rounded-full flex items-center justify-center mb-2">
                              <span className="font-bold text-primary">A</span>
                            </div>
                            <div className="text-xs">Atoms</div>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                          <div className="text-center">
                            <div className="w-12 h-12 bg-secondary/20 border-2 border-secondary rounded-full flex items-center justify-center mb-2">
                              <span className="font-bold text-secondary">M</span>
                            </div>
                            <div className="text-xs">Molecules</div>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                          <div className="text-center">
                            <div className="w-12 h-12 bg-accent/20 border-2 border-accent rounded-full flex items-center justify-center mb-2">
                              <span className="font-bold text-accent">O</span>
                            </div>
                            <div className="text-xs">Organisms</div>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                          <div className="text-center">
                            <div className="w-12 h-12 bg-info/20 border-2 border-info rounded-full flex items-center justify-center mb-2">
                              <span className="font-bold text-info">T</span>
                            </div>
                            <div className="text-xs">Templates</div>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                          <div className="text-center">
                            <div className="w-12 h-12 bg-success/20 border-2 border-success rounded-full flex items-center justify-center mb-2">
                              <span className="font-bold text-success">P</span>
                            </div>
                            <div className="text-xs">Pages</div>
                          </div>
                        </div>
                      </div>

                      {/* Example Composition */}
                      <div className="border border-base-300 rounded-lg p-4">
                        <h5 className="font-semibold mb-3">Example: Search Form Composition</h5>
                        <div className="grid md:grid-cols-5 gap-4 text-sm">
                          <div className="text-center">
                            <div className="border-2 border-primary/30 rounded p-2 mb-2 bg-primary/5">
                              <div className="w-4 h-4 bg-primary/40 rounded mx-auto mb-1"></div>
                              <div className="h-2 bg-primary/40 rounded"></div>
                            </div>
                            <div className="font-medium">Icon + Input</div>
                            <div className="text-xs text-base-content/60">Atoms</div>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-base-content/40 mx-auto mt-6" />
                          <div className="text-center">
                            <div className="border-2 border-secondary/30 rounded p-2 mb-2 bg-secondary/5">
                              <div className="flex gap-1">
                                <div className="w-3 h-3 bg-secondary/40 rounded"></div>
                                <div className="flex-1 h-3 bg-secondary/40 rounded"></div>
                              </div>
                            </div>
                            <div className="font-medium">Search Bar</div>
                            <div className="text-xs text-base-content/60">Molecule</div>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-base-content/40 mx-auto mt-6" />
                          <div className="text-center">
                            <div className="border-2 border-accent/30 rounded p-2 mb-2 bg-accent/5">
                              <div className="space-y-1">
                                <div className="h-2 bg-accent/40 rounded"></div>
                                <div className="flex gap-1">
                                  <div className="w-2 h-2 bg-accent/40 rounded"></div>
                                  <div className="flex-1 h-2 bg-accent/40 rounded"></div>
                                </div>
                                <div className="h-2 bg-accent/40 rounded w-3/4"></div>
                              </div>
                            </div>
                            <div className="font-medium">Search Panel</div>
                            <div className="text-xs text-base-content/60">Organism</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Component Relationships</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Composition Rules</h4>
                      <div className="space-y-2 text-sm text-base-content/80">
                        <div>• Atoms don't contain other atoms</div>
                        <div>• Molecules contain 2-5 atoms</div>
                        <div>• Organisms contain molecules and atoms</div>
                        <div>• Templates arrange organisms</div>
                        <div>• Pages add content to templates</div>
                      </div>
                    </div>

                    <div className="border border-base-300 rounded-lg p-4">
                      <h4 className="font-semibold mb-3">Data Flow</h4>
                      <div className="space-y-2 text-sm text-base-content/80">
                        <div>• Props flow down the hierarchy</div>
                        <div>• Events bubble up to containers</div>
                        <div>• State management at organism level</div>
                        <div>• Business logic in organisms/pages</div>
                        <div>• Pure presentation in atoms/molecules</div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Implementation */}
            {activeTab === 'implementation' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Development Process</h3>
                  
                  <div className="space-y-4">
                    {implementationStages.map((stage, index) => (
                      <div key={index} className="border border-base-300 rounded-lg p-6">
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold mb-2">{stage.stage}</h4>
                            <p className="text-base-content/70 mb-3">{stage.description}</p>
                            <div className="grid md:grid-cols-2 gap-2">
                              {stage.tasks.map((task, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                                  <span>{task}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Code Organization</h3>
                  
                  <div className="border border-base-300 rounded-lg p-6 bg-base-100">
                    <div className="font-mono text-sm">
                      <div className="mb-4">
                        <div className="font-semibold mb-2">File Structure</div>
                        <div className="space-y-1 text-base-content/80">
                          <div>📁 components/</div>
                          <div className="pl-4">📁 atoms/ (buttons, inputs, icons)</div>
                          <div className="pl-4">📁 molecules/ (search-bar, nav-item)</div>
                          <div className="pl-4">📁 organisms/ (timeline, sidebar)</div>
                          <div className="pl-4">📁 templates/ (layouts)</div>
                          <div>📁 pages/ (complete implementations)</div>
                          <div>📁 tokens/ (design tokens, themes)</div>
                        </div>
                      </div>
                      
                      <div>
                        <div className="font-semibold mb-2">Component Naming</div>
                        <div className="space-y-1 text-base-content/80">
                          <div>• Button.tsx (atom)</div>
                          <div>• SearchBar.tsx (molecule)</div>
                          <div>• TimelineView.tsx (organism)</div>
                          <div>• MainLayout.tsx (template)</div>
                          <div>• ChatPage.tsx (page)</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Best Practices */}
            {activeTab === 'best-practices' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Page Development Guidelines</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold text-success mb-3">✓ Best Practices</h4>
                      <ul className="space-y-2 text-sm text-base-content/80">
                        <li>• Build pages by composing existing components</li>
                        <li>• Keep business logic in organisms or higher</li>
                        <li>• Use consistent naming conventions</li>
                        <li>• Implement proper error boundaries</li>
                        <li>• Optimize for performance and accessibility</li>
                        <li>• Test component composition thoroughly</li>
                        <li>• Document component dependencies</li>
                        <li>• Follow responsive design principles</li>
                      </ul>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold text-error mb-3">✗ Anti-Patterns</h4>
                      <ul className="space-y-2 text-sm text-base-content/80">
                        <li>• Creating page-specific components unnecessarily</li>
                        <li>• Putting business logic in atoms or molecules</li>
                        <li>• Inconsistent component composition patterns</li>
                        <li>• Skipping intermediate levels (atoms to organisms)</li>
                        <li>• Hard-coding values instead of using design tokens</li>
                        <li>• Ignoring responsive breakpoints</li>
                        <li>• Poor error handling at page level</li>
                        <li>• Mixing presentation and business logic</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Quality Checklist</h3>
                  
                  <div className="border border-base-300 rounded-lg p-6 bg-base-100">
                    <div className="grid md:grid-cols-3 gap-6">
                      <div>
                        <h4 className="font-semibold mb-3">Functionality</h4>
                        <div className="space-y-2">
                          {[
                            'All interactive elements work',
                            'Forms validate properly',
                            'Navigation flows correctly',
                            'Error states are handled',
                            'Loading states are shown'
                          ].map((item, i) => (
                            <label key={i} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" className="checkbox checkbox-primary checkbox-xs" />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-3">Accessibility</h4>
                        <div className="space-y-2">
                          {[
                            'Keyboard navigation works',
                            'Screen reader friendly',
                            'Sufficient color contrast',
                            'Semantic HTML structure',
                            'Focus management'
                          ].map((item, i) => (
                            <label key={i} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" className="checkbox checkbox-secondary checkbox-xs" />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-3">Performance</h4>
                        <div className="space-y-2">
                          {[
                            'Fast initial load',
                            'Smooth interactions',
                            'Optimized images',
                            'Efficient re-renders',
                            'Mobile performance'
                          ].map((item, i) => (
                            <label key={i} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" className="checkbox checkbox-accent checkbox-xs" />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

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