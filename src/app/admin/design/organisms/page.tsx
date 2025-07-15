'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks, faUser, faRobot, faCog, faPlus, faCheck, faStop } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon, XMarkIcon, Bars3Icon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

export default function OrganismsPage() {
  const [activeTab, setActiveTab] = useState('navigation');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState('bash');

  const timelineMessages = [
    { id: 1, type: 'human', content: 'Can you help me analyze the performance of my React app?', time: '2:30 PM' },
    { id: 2, type: 'ai', content: 'I\'d be happy to help! Let me start by examining your React app structure and running some performance analysis tools.', time: '2:31 PM' },
    { id: 3, type: 'tool', tool: 'bash', content: 'npm run build --analyze', time: '2:31 PM' },
    { id: 4, type: 'ai', content: 'Based on the analysis, I can see a few optimization opportunities. Your bundle size could be reduced by implementing code splitting.', time: '2:32 PM' },
  ];

  const navigationItems = [
    { icon: faTerminal, label: 'Terminal', active: true },
    { icon: faTasks, label: 'Tasks', badge: 3 },
    { icon: faUser, label: 'Profile' },
    { icon: faCog, label: 'Settings' },
  ];

  const toolOptions = [
    { id: 'bash', name: 'Bash Command', icon: faTerminal, description: 'Execute shell commands' },
    { id: 'file-read', name: 'Read File', icon: faTasks, description: 'Read file contents' },
    { id: 'search', name: 'Search', icon: faSearch, description: 'Search through files' },
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Organisms</h1>
          <p className="text-base-content/70 mb-4">
            Complex components composed of molecules and atoms that form distinct sections of an interface. Organisms often contain business logic and could exist independently.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-accent rounded-full"></div>
            <span>Complex composition • Business logic • Standalone sections</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-base-100 rounded-lg border border-base-300">
          <div className="flex border-b border-base-300 overflow-x-auto">
            {[
              { id: 'navigation', label: 'Navigation', desc: 'Sidebars, headers, menus' },
              { id: 'timeline', label: 'Timeline', desc: 'Message streams, conversations' },
              { id: 'modals', label: 'Modals & Overlays', desc: 'Dialogs, popovers' },
              { id: 'forms', label: 'Complex Forms', desc: 'Multi-step, validation' },
              { id: 'data', label: 'Data Display', desc: 'Tables, dashboards' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-32 p-4 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent border-b-2 border-accent'
                    : 'hover:bg-base-200'
                }`}
              >
                <div className="font-medium text-sm">{tab.label}</div>
                <div className="text-xs text-base-content/60">{tab.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            
            {/* Navigation Organisms */}
            {activeTab === 'navigation' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Sidebar Navigation</h3>
                  <p className="text-base-content/70 mb-6">Complete sidebar with collapsible states, navigation items, and user context</p>
                  
                  <div className="border border-base-300 rounded-lg overflow-hidden">
                    <div className="flex h-96">
                      {/* Sidebar */}
                      <motion.div
                        animate={{ width: sidebarExpanded ? 280 : 64 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className="bg-base-100 border-r border-base-300 flex flex-col"
                      >
                        {/* Sidebar Header */}
                        <div className="p-4 border-b border-base-300">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                              <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 text-primary-content" />
                            </div>
                            <AnimatePresence>
                              {sidebarExpanded && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="font-bold text-lg"
                                >
                                  Lace
                                </motion.div>
                              )}
                            </AnimatePresence>
                            <button
                              onClick={() => setSidebarExpanded(!sidebarExpanded)}
                              className="ml-auto p-1 hover:bg-base-200 rounded"
                            >
                              <ChevronRightIcon 
                                className={`w-4 h-4 transition-transform ${sidebarExpanded ? 'rotate-180' : ''}`} 
                              />
                            </button>
                          </div>
                        </div>

                        {/* Navigation Items */}
                        <div className="flex-1 p-2">
                          <div className="space-y-1">
                            {navigationItems.map((item, index) => (
                              <div
                                key={index}
                                className={`flex items-center gap-3 p-3 rounded cursor-pointer transition-colors ${
                                  item.active ? 'bg-primary/10 text-primary' : 'hover:bg-base-200'
                                }`}
                              >
                                <FontAwesomeIcon icon={item.icon} className="w-5 h-5" />
                                <AnimatePresence>
                                  {sidebarExpanded && (
                                    <motion.div
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      exit={{ opacity: 0 }}
                                      className="flex-1 flex items-center justify-between"
                                    >
                                      <span className="font-medium">{item.label}</span>
                                      {item.badge && (
                                        <div className="badge badge-primary badge-sm">{item.badge}</div>
                                      )}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* User Section */}
                        <div className="p-4 border-t border-base-300">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                              <FontAwesomeIcon icon={faUser} className="w-4 h-4 text-accent" />
                            </div>
                            <AnimatePresence>
                              {sidebarExpanded && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="flex-1"
                                >
                                  <div className="font-medium text-sm">John Doe</div>
                                  <div className="text-xs text-base-content/60">Developer</div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </motion.div>

                      {/* Main Content */}
                      <div className="flex-1 p-6">
                        <h4 className="font-semibold mb-3">Main Content Area</h4>
                        <p className="text-base-content/70 text-sm">
                          This represents the main application content. The sidebar automatically adjusts its width 
                          based on the collapsed state, providing more space for content when needed.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Mobile Navigation</h3>
                  
                  <div className="border border-base-300 rounded-lg overflow-hidden bg-white">
                    <div className="relative h-64">
                      {/* Mobile Header */}
                      <div className="flex items-center justify-between p-4 border-b border-base-300 bg-base-100">
                        <button
                          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                          className="p-2 hover:bg-base-200 rounded"
                        >
                          <Bars3Icon className="w-6 h-6" />
                        </button>
                        <div className="font-bold">Lace</div>
                        <div className="w-10"></div>
                      </div>

                      {/* Mobile Sidebar Overlay */}
                      <AnimatePresence>
                        {mobileMenuOpen && (
                          <>
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 bg-black/20 z-10"
                              onClick={() => setMobileMenuOpen(false)}
                            />
                            <motion.div
                              initial={{ x: -280 }}
                              animate={{ x: 0 }}
                              exit={{ x: -280 }}
                              transition={{ type: "spring", stiffness: 400, damping: 30 }}
                              className="absolute left-0 top-0 w-72 h-full bg-base-100 border-r border-base-300 z-20"
                            >
                              <div className="p-4 border-b border-base-300">
                                <div className="flex items-center justify-between">
                                  <div className="font-bold text-lg">Menu</div>
                                  <button
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="p-1 hover:bg-base-200 rounded"
                                  >
                                    <XMarkIcon className="w-5 h-5" />
                                  </button>
                                </div>
                              </div>
                              <div className="p-2">
                                {navigationItems.map((item, index) => (
                                  <div
                                    key={index}
                                    className={`flex items-center gap-3 p-3 rounded cursor-pointer transition-colors ${
                                      item.active ? 'bg-primary/10 text-primary' : 'hover:bg-base-200'
                                    }`}
                                  >
                                    <FontAwesomeIcon icon={item.icon} className="w-5 h-5" />
                                    <span className="font-medium">{item.label}</span>
                                    {item.badge && (
                                      <div className="badge badge-primary badge-sm ml-auto">{item.badge}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>

                      {/* Mobile Content */}
                      <div className="p-4">
                        <h4 className="font-semibold mb-2">Mobile Layout</h4>
                        <p className="text-sm text-base-content/70">
                          Touch-optimized navigation with overlay sidebar and backdrop.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Timeline Organisms */}
            {activeTab === 'timeline' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Conversation Timeline</h3>
                  <p className="text-base-content/70 mb-6">Complete message stream with different message types, avatars, and interactive elements</p>
                  
                  <div className="border border-base-300 rounded-lg bg-base-100 h-96 flex flex-col">
                    {/* Timeline Header */}
                    <div className="p-4 border-b border-base-300">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                          <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-semibold">React Performance Analysis</div>
                          <div className="text-sm text-base-content/60">Active conversation</div>
                        </div>
                        <div className="ml-auto">
                          <div className="badge badge-success">Live</div>
                        </div>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {timelineMessages.map((message) => (
                        <div key={message.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0">
                            {message.type === 'human' && (
                              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                                <FontAwesomeIcon icon={faUser} className="w-4 h-4 text-primary" />
                              </div>
                            )}
                            {message.type === 'ai' && (
                              <div className="w-8 h-8 bg-secondary/20 rounded-full flex items-center justify-center">
                                <FontAwesomeIcon icon={faRobot} className="w-4 h-4 text-secondary" />
                              </div>
                            )}
                            {message.type === 'tool' && (
                              <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                                <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 text-accent" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm capitalize">{message.type}</span>
                              {message.tool && (
                                <div className="badge badge-accent badge-sm">{message.tool}</div>
                              )}
                              <span className="text-xs text-base-content/60 ml-auto">{message.time}</span>
                            </div>
                            <div className={`rounded-lg p-3 ${
                              message.type === 'tool' 
                                ? 'bg-base-200 font-mono text-sm' 
                                : 'bg-base-200'
                            }`}>
                              {message.content}
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Typing Indicator */}
                      <div className="flex gap-3">
                        <div className="w-8 h-8 bg-secondary/20 rounded-full flex items-center justify-center">
                          <FontAwesomeIcon icon={faRobot} className="w-4 h-4 text-secondary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">AI</span>
                            <span className="text-xs text-base-content/60">thinking...</span>
                          </div>
                          <div className="bg-base-200 rounded-lg p-3 flex items-center gap-2">
                            <div className="flex gap-1">
                              <div className="w-2 h-2 bg-base-content/40 rounded-full animate-pulse"></div>
                              <div className="w-2 h-2 bg-base-content/40 rounded-full animate-pulse delay-100"></div>
                              <div className="w-2 h-2 bg-base-content/40 rounded-full animate-pulse delay-200"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Input Area */}
                    <div className="p-4 border-t border-base-300">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            placeholder="Type your message..."
                            className="input input-bordered w-full pr-12"
                          />
                          <button className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 hover:bg-base-200 rounded">
                            <FontAwesomeIcon icon={faSearch} className="w-4 h-4 text-base-content/60" />
                          </button>
                        </div>
                        <button className="btn btn-primary">
                          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Modal Organisms */}
            {activeTab === 'modals' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Modal Dialogs</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold mb-3">Tool Selection Modal</h4>
                      <button
                        onClick={() => setModalOpen(true)}
                        className="btn btn-primary"
                      >
                        Open Tool Selector
                      </button>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-3">Confirmation Dialog</h4>
                      <div className="border border-base-300 rounded-lg p-4 bg-base-200">
                        <div className="flex items-center gap-3 mb-3">
                          <FontAwesomeIcon icon={faTerminal} className="w-5 h-5 text-warning" />
                          <div className="font-semibold">Confirm Action</div>
                        </div>
                        <p className="text-sm text-base-content/70 mb-4">
                          This will permanently delete the selected files. This action cannot be undone.
                        </p>
                        <div className="flex gap-2 justify-end">
                          <button className="btn btn-sm">Cancel</button>
                          <button className="btn btn-sm btn-error">Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tool Selection Modal */}
                  <AnimatePresence>
                    {modalOpen && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/50"
                          onClick={() => setModalOpen(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="relative bg-base-100 rounded-lg border border-base-300 w-full max-w-md"
                        >
                          <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                              <h3 className="text-lg font-bold">Select Tool</h3>
                              <button
                                onClick={() => setModalOpen(false)}
                                className="p-1 hover:bg-base-200 rounded"
                              >
                                <XMarkIcon className="w-5 h-5" />
                              </button>
                            </div>
                            
                            <div className="space-y-2">
                              {toolOptions.map((tool) => (
                                <label
                                  key={tool.id}
                                  className={`flex items-center gap-3 p-3 border rounded cursor-pointer transition-colors ${
                                    selectedTool === tool.id
                                      ? 'border-primary bg-primary/10'
                                      : 'border-base-300 hover:border-base-content/20'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="tool"
                                    value={tool.id}
                                    checked={selectedTool === tool.id}
                                    onChange={(e) => setSelectedTool(e.target.value)}
                                    className="radio radio-primary radio-sm"
                                  />
                                  <FontAwesomeIcon icon={tool.icon} className="w-5 h-5 text-base-content/60" />
                                  <div className="flex-1">
                                    <div className="font-medium">{tool.name}</div>
                                    <div className="text-sm text-base-content/60">{tool.description}</div>
                                  </div>
                                </label>
                              ))}
                            </div>

                            <div className="flex gap-2 justify-end mt-6">
                              <button
                                onClick={() => setModalOpen(false)}
                                className="btn btn-outline"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => setModalOpen(false)}
                                className="btn btn-primary"
                              >
                                Select Tool
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            )}

            {/* Forms */}
            {activeTab === 'forms' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Multi-Step Configuration</h3>
                  
                  <div className="border border-base-300 rounded-lg bg-base-100 p-6">
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">API Configuration</h4>
                        <span className="text-sm text-base-content/60">Step 2 of 3</span>
                      </div>
                      <div className="flex gap-1">
                        <div className="h-2 bg-primary rounded-full flex-1"></div>
                        <div className="h-2 bg-primary rounded-full flex-1"></div>
                        <div className="h-2 bg-base-300 rounded-full flex-1"></div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="form-control">
                          <label className="label">
                            <span className="label-text font-medium">API Endpoint</span>
                            <span className="label-text-alt text-error">Required</span>
                          </label>
                          <input 
                            type="url" 
                            placeholder="https://api.example.com" 
                            className="input input-bordered" 
                          />
                        </div>
                        
                        <div className="form-control">
                          <label className="label">
                            <span className="label-text font-medium">API Key</span>
                          </label>
                          <input 
                            type="password" 
                            placeholder="Enter your API key" 
                            className="input input-bordered" 
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="form-control">
                          <label className="label">
                            <span className="label-text font-medium">Request Timeout</span>
                          </label>
                          <select className="select select-bordered">
                            <option>30 seconds</option>
                            <option>60 seconds</option>
                            <option>120 seconds</option>
                          </select>
                        </div>
                        
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <span className="label-text">Enable debug logging</span>
                            <input type="checkbox" className="toggle toggle-primary" />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between mt-6">
                      <button className="btn btn-outline">
                        <ChevronRightIcon className="w-4 h-4 rotate-180 mr-2" />
                        Previous
                      </button>
                      <button className="btn btn-primary">
                        Next
                        <ChevronRightIcon className="w-4 h-4 ml-2" />
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Data Display */}
            {activeTab === 'data' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Dashboard Overview</h3>
                  
                  <div className="grid md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-base-100 border border-base-300 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <FontAwesomeIcon icon={faTerminal} className="w-5 h-5 text-primary" />
                        <span className="font-medium">Active Sessions</span>
                      </div>
                      <div className="text-2xl font-bold">24</div>
                      <div className="text-sm text-success">+12% from yesterday</div>
                    </div>
                    
                    <div className="bg-base-100 border border-base-300 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <FontAwesomeIcon icon={faTasks} className="w-5 h-5 text-secondary" />
                        <span className="font-medium">Completed Tasks</span>
                      </div>
                      <div className="text-2xl font-bold">156</div>
                      <div className="text-sm text-success">+8% from yesterday</div>
                    </div>
                    
                    <div className="bg-base-100 border border-base-300 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <FontAwesomeIcon icon={faUser} className="w-5 h-5 text-accent" />
                        <span className="font-medium">Active Users</span>
                      </div>
                      <div className="text-2xl font-bold">89</div>
                      <div className="text-sm text-error">-3% from yesterday</div>
                    </div>
                  </div>

                  <div className="bg-base-100 border border-base-300 rounded-lg">
                    <div className="p-4 border-b border-base-300">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Recent Activity</h4>
                        <button className="btn btn-sm btn-outline">
                          <FontAwesomeIcon icon={faSearch} className="w-4 h-4 mr-2" />
                          Filter
                        </button>
                      </div>
                    </div>
                    
                    <div className="divide-y divide-base-300">
                      {[
                        { user: 'John Doe', action: 'Executed bash command', time: '2 minutes ago', status: 'success' },
                        { user: 'Jane Smith', action: 'Updated configuration', time: '5 minutes ago', status: 'success' },
                        { user: 'Bob Wilson', action: 'Failed to connect', time: '8 minutes ago', status: 'error' },
                        { user: 'Alice Johnson', action: 'Created new task', time: '12 minutes ago', status: 'success' },
                      ].map((activity, index) => (
                        <div key={index} className="p-4 hover:bg-base-200/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-base-300 rounded-full flex items-center justify-center">
                                <FontAwesomeIcon icon={faUser} className="w-4 h-4 text-base-content/60" />
                              </div>
                              <div>
                                <div className="font-medium text-sm">{activity.user}</div>
                                <div className="text-sm text-base-content/70">{activity.action}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`badge badge-sm ${
                                activity.status === 'success' ? 'badge-success' : 'badge-error'
                              }`}>
                                {activity.status}
                              </div>
                              <div className="text-xs text-base-content/60 mt-1">{activity.time}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

        {/* Organism Guidelines */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Organism Design Guidelines</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-success">✓ Well-Designed Organisms</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Self-contained with clear boundaries</li>
                <li>• Compose multiple molecules logically</li>
                <li>• Handle their own state and interactions</li>
                <li>• Responsive and accessible by default</li>
                <li>• Include business logic when appropriate</li>
                <li>• Can function independently</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-error">✗ Poor Organism Design</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Tightly coupled to specific contexts</li>
                <li>• Mixing unrelated functionality</li>
                <li>• Inconsistent interaction patterns</li>
                <li>• Not handling edge cases</li>
                <li>• Poor mobile/responsive behavior</li>
                <li>• Missing accessibility features</li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}