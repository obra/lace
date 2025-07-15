'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks, faUser, faRobot, faCog, faPlus, faCheck } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

export default function MoleculesPage() {
  const [activeTab, setActiveTab] = useState('navigation');
  const [searchValue, setSearchValue] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('dark');
  const [showAlert, setShowAlert] = useState(true);
  const [switchValue, setSwitchValue] = useState(false);

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Molecules</h1>
          <p className="text-base-content/70 mb-4">
            Simple groups of atoms functioning together as a unit. Each molecule has a single, clear responsibility and combines 2-5 atoms to solve specific UI patterns.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-secondary rounded-full"></div>
            <span>Composed of atoms • Single responsibility • Reusable patterns</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-base-100 rounded-lg border border-base-300">
          <div className="flex border-b border-base-300 overflow-x-auto">
            {[
              { id: 'navigation', label: 'Navigation', desc: 'Menu items, breadcrumbs' },
              { id: 'forms', label: 'Form Patterns', desc: 'Search, inputs with labels' },
              { id: 'feedback', label: 'Feedback', desc: 'Alerts, badges, status' },
              { id: 'content', label: 'Content', desc: 'Cards, avatars, lists' },
              { id: 'controls', label: 'Controls', desc: 'Toggles, selectors' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-32 p-4 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-secondary/10 text-secondary border-b-2 border-secondary'
                    : 'hover:bg-base-200'
                }`}
              >
                <div className="font-medium text-sm">{tab.label}</div>
                <div className="text-xs text-base-content/60">{tab.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            
            {/* Navigation Molecules */}
            {activeTab === 'navigation' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Navigation Items</h3>
                  <p className="text-base-content/70 mb-6">Icon + label combinations for menus and navigation</p>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    
                    {/* Sidebar Navigation Items */}
                    <div className="border border-base-300 rounded p-4">
                      <h4 className="font-semibold mb-3">Sidebar Navigation</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 p-3 hover:bg-base-200 rounded cursor-pointer">
                          <FontAwesomeIcon icon={faTerminal} className="w-5 h-5 text-base-content" />
                          <span className="font-medium">Terminal</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-primary/10 text-primary rounded">
                          <FontAwesomeIcon icon={faTasks} className="w-5 h-5" />
                          <span className="font-medium">Tasks</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 hover:bg-base-200 rounded cursor-pointer">
                          <FontAwesomeIcon icon={faCog} className="w-5 h-5 text-base-content" />
                          <span className="font-medium">Settings</span>
                        </div>
                      </div>
                    </div>

                    {/* Collapsed Navigation */}
                    <div className="border border-base-300 rounded p-4">
                      <h4 className="font-semibold mb-3">Collapsed Navigation</h4>
                      <div className="space-y-2 max-w-16">
                        <div className="flex items-center justify-center p-3 hover:bg-base-200 rounded cursor-pointer">
                          <FontAwesomeIcon icon={faTerminal} className="w-5 h-5 text-base-content" />
                        </div>
                        <div className="flex items-center justify-center p-3 bg-primary/10 text-primary rounded">
                          <FontAwesomeIcon icon={faTasks} className="w-5 h-5" />
                        </div>
                        <div className="flex items-center justify-center p-3 hover:bg-base-200 rounded cursor-pointer">
                          <FontAwesomeIcon icon={faCog} className="w-5 h-5 text-base-content" />
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Expandable Items</h3>
                  <div className="space-y-2 max-w-md">
                    <div className="border border-base-300 rounded">
                      <button className="w-full flex items-center justify-between p-3 hover:bg-base-200">
                        <div className="flex items-center gap-3">
                          <FontAwesomeIcon icon={faCog} className="w-5 h-5 text-base-content" />
                          <span>Settings</span>
                        </div>
                        <ChevronRightIcon className="w-4 h-4 text-base-content/60" />
                      </button>
                    </div>
                    <div className="border border-base-300 rounded">
                      <button className="w-full flex items-center justify-between p-3 bg-base-200">
                        <div className="flex items-center gap-3">
                          <FontAwesomeIcon icon={faUser} className="w-5 h-5 text-base-content" />
                          <span>Profile</span>
                        </div>
                        <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
                      </button>
                      <div className="px-6 pb-3">
                        <div className="text-sm text-base-content/70 py-2">Edit Profile</div>
                        <div className="text-sm text-base-content/70 py-2">Change Password</div>
                        <div className="text-sm text-base-content/70 py-2">Privacy Settings</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Breadcrumbs</h3>
                  <div className="border border-base-300 rounded p-4">
                    <nav className="flex items-center space-x-2 text-sm">
                      <a href="#" className="text-primary hover:text-primary/80">Admin</a>
                      <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                      <a href="#" className="text-primary hover:text-primary/80">Design</a>
                      <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                      <span className="text-base-content/60">Molecules</span>
                    </nav>
                  </div>
                </div>

              </div>
            )}

            {/* Form Patterns */}
            {activeTab === 'forms' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Search Patterns</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    
                    {/* Basic Search */}
                    <div className="space-y-4">
                      <h4 className="font-semibold">Basic Search</h4>
                      <div className="relative">
                        <FontAwesomeIcon 
                          icon={faSearch} 
                          className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-base-content/40"
                        />
                        <input
                          type="search"
                          placeholder="Search..."
                          value={searchValue}
                          onChange={(e) => setSearchValue(e.target.value)}
                          className="input input-bordered w-full pl-10"
                        />
                      </div>
                      <div className="text-xs text-base-content/60 font-mono">
                        Icon + Input field
                      </div>
                    </div>

                    {/* Search with Button */}
                    <div className="space-y-4">
                      <h4 className="font-semibold">Search with Action</h4>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <FontAwesomeIcon 
                            icon={faSearch} 
                            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-base-content/40"
                          />
                          <input
                            type="search"
                            placeholder="Search files..."
                            className="input input-bordered w-full pl-10"
                          />
                        </div>
                        <button className="btn btn-primary">
                          <FontAwesomeIcon icon={faSearch} className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="text-xs text-base-content/60 font-mono">
                        Icon + Input + Button
                      </div>
                    </div>

                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Labeled Inputs</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold">Standard Form Field</h4>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Email Address</span>
                          <span className="label-text-alt text-error">Required</span>
                        </label>
                        <input 
                          type="email" 
                          placeholder="Enter your email" 
                          className="input input-bordered" 
                        />
                        <label className="label">
                          <span className="label-text-alt text-base-content/60">We'll never share your email</span>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold">Field with Status</h4>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Password</span>
                        </label>
                        <input 
                          type="password" 
                          placeholder="Enter password" 
                          className="input input-bordered input-success" 
                        />
                        <label className="label">
                          <span className="label-text-alt text-success">Strong password!</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Input Groups</h3>
                  
                  <div className="space-y-4 max-w-lg">
                    <div className="join w-full">
                      <input 
                        className="input input-bordered join-item flex-1" 
                        placeholder="Enter command"
                      />
                      <button className="btn btn-primary join-item">
                        <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                        Run
                      </button>
                    </div>
                    
                    <div className="join w-full">
                      <select className="select select-bordered join-item">
                        <option>HTTP</option>
                        <option>HTTPS</option>
                      </select>
                      <input 
                        className="input input-bordered join-item flex-1" 
                        placeholder="api.example.com"
                      />
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Feedback Molecules */}
            {activeTab === 'feedback' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Alert Messages</h3>
                  
                  <div className="space-y-4">
                    <AnimatePresence>
                      {showAlert && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="alert alert-success"
                        >
                          <FontAwesomeIcon icon={faUser} className="w-5 h-5" />
                          <div className="flex-1">
                            <h4 className="font-semibold">Success!</h4>
                            <div className="text-sm">Your changes have been saved successfully.</div>
                          </div>
                          <button 
                            onClick={() => setShowAlert(false)}
                            className="btn btn-sm btn-ghost"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="alert alert-warning">
                      <FontAwesomeIcon icon={faCog} className="w-5 h-5" />
                      <div>
                        <h4 className="font-semibold">Warning</h4>
                        <div className="text-sm">This action cannot be undone.</div>
                      </div>
                    </div>

                    <div className="alert alert-error">
                      <FontAwesomeIcon icon={faTerminal} className="w-5 h-5" />
                      <div>
                        <h4 className="font-semibold">Error</h4>
                        <div className="text-sm">Failed to connect to the server.</div>
                      </div>
                    </div>

                    <div className="alert alert-info">
                      <FontAwesomeIcon icon={faTasks} className="w-5 h-5" />
                      <div>
                        <h4 className="font-semibold">Information</h4>
                        <div className="text-sm">New features are available in the latest update.</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Status Badges</h3>
                  
                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <h4 className="font-semibold">Simple Badges</h4>
                      <div className="flex flex-wrap gap-2">
                        <div className="badge badge-primary">Primary</div>
                        <div className="badge badge-secondary">Secondary</div>
                        <div className="badge badge-accent">Accent</div>
                        <div className="badge badge-success">Success</div>
                        <div className="badge badge-warning">Warning</div>
                        <div className="badge badge-error">Error</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="font-semibold">Icon Badges</h4>
                      <div className="flex flex-wrap gap-2">
                        <div className="badge badge-success gap-1">
                          <FontAwesomeIcon icon={faUser} className="w-3 h-3" />
                          Online
                        </div>
                        <div className="badge badge-warning gap-1">
                          <FontAwesomeIcon icon={faCog} className="w-3 h-3" />
                          Paused
                        </div>
                        <div className="badge badge-error gap-1">
                          <FontAwesomeIcon icon={faTerminal} className="w-3 h-3" />
                          Failed
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="font-semibold">Count Badges</h4>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span>Messages</span>
                          <div className="badge badge-primary">3</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>Notifications</span>
                          <div className="badge badge-error">12</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>Tasks</span>
                          <div className="badge badge-success">✓</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Loading States</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold">Button Loading</h4>
                      <div className="flex gap-2">
                        <button className="btn btn-primary loading">Loading</button>
                        <button className="btn btn-secondary">
                          <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 mr-2" />
                          Ready
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold">Content Loading</h4>
                      <div className="flex items-center gap-3">
                        <div className="loading loading-spinner loading-sm"></div>
                        <span className="text-sm text-base-content/70">Processing...</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="loading loading-dots loading-sm"></div>
                        <span className="text-sm text-base-content/70">Thinking...</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Content Molecules */}
            {activeTab === 'content' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Avatar Combinations</h3>
                  
                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold">User Avatar</h4>
                      <div className="flex items-center gap-3">
                        <div className="avatar">
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                            <FontAwesomeIcon icon={faUser} className="w-5 h-5 text-primary" />
                          </div>
                        </div>
                        <div>
                          <div className="font-medium">John Doe</div>
                          <div className="text-sm text-base-content/60">Human</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold">AI Avatar</h4>
                      <div className="flex items-center gap-3">
                        <div className="avatar">
                          <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                            <FontAwesomeIcon icon={faRobot} className="w-5 h-5 text-secondary" />
                          </div>
                        </div>
                        <div>
                          <div className="font-medium">Lace AI</div>
                          <div className="text-sm text-base-content/60">Assistant</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold">Status Avatar</h4>
                      <div className="flex items-center gap-3">
                        <div className="avatar online">
                          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                            <FontAwesomeIcon icon={faUser} className="w-5 h-5 text-accent" />
                          </div>
                        </div>
                        <div>
                          <div className="font-medium">Active User</div>
                          <div className="text-sm text-success">Online</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Simple Cards</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="card bg-base-100 border border-base-300">
                      <div className="card-body p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <FontAwesomeIcon icon={faTerminal} className="w-5 h-5 text-primary" />
                          <h3 className="font-semibold">Terminal Session</h3>
                        </div>
                        <p className="text-sm text-base-content/70 mb-3">
                          Interactive command line interface for system operations
                        </p>
                        <div className="flex justify-between items-center">
                          <div className="badge badge-success">Active</div>
                          <button className="btn btn-sm btn-primary">Connect</button>
                        </div>
                      </div>
                    </div>

                    <div className="card bg-base-100 border border-base-300">
                      <div className="card-body p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <FontAwesomeIcon icon={faTasks} className="w-5 h-5 text-secondary" />
                          <h3 className="font-semibold">Task Manager</h3>
                        </div>
                        <p className="text-sm text-base-content/70 mb-3">
                          Organize and track your project tasks efficiently
                        </p>
                        <div className="flex justify-between items-center">
                          <div className="badge badge-warning">3 Pending</div>
                          <button className="btn btn-sm btn-outline">View All</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">List Items</h3>
                  
                  <div className="max-w-md space-y-2">
                    <div className="flex items-center justify-between p-3 bg-base-100 border border-base-300 rounded">
                      <div className="flex items-center gap-3">
                        <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 text-base-content/60" />
                        <span>process.log</span>
                      </div>
                      <div className="text-sm text-base-content/60">2.1 MB</div>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-base-100 border border-base-300 rounded">
                      <div className="flex items-center gap-3">
                        <FontAwesomeIcon icon={faTasks} className="w-4 h-4 text-base-content/60" />
                        <span>tasks.json</span>
                      </div>
                      <div className="text-sm text-base-content/60">156 KB</div>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/30 rounded">
                      <div className="flex items-center gap-3">
                        <FontAwesomeIcon icon={faCog} className="w-4 h-4 text-primary" />
                        <span>config.yaml</span>
                      </div>
                      <div className="text-sm text-primary">Active</div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Controls */}
            {activeTab === 'controls' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Theme Selector</h3>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl">
                    {['light', 'dark', 'cupcake', 'corporate', 'synthwave', 'cyberpunk'].map((theme) => (
                      <button
                        key={theme}
                        onClick={() => setSelectedTheme(theme)}
                        className={`p-3 rounded-lg border-2 text-sm transition-all ${
                          selectedTheme === theme ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-base-content/20'
                        }`}
                      >
                        <div className="w-full h-4 rounded flex overflow-hidden mb-2">
                          <div className="flex-1 bg-primary"></div>
                          <div className="flex-1 bg-secondary"></div>
                          <div className="flex-1 bg-accent"></div>
                        </div>
                        <span className="capitalize font-medium">{theme}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Toggle Controls</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold">Labeled Toggles</h4>
                      <div className="space-y-3">
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <div className="flex items-center gap-2">
                              <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 text-base-content/60" />
                              <span className="label-text">Enable terminal access</span>
                            </div>
                            <input 
                              type="checkbox" 
                              className="toggle toggle-primary" 
                              checked={switchValue}
                              onChange={(e) => setSwitchValue(e.target.checked)}
                            />
                          </label>
                        </div>
                        
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <div className="flex items-center gap-2">
                              <FontAwesomeIcon icon={faTasks} className="w-4 h-4 text-base-content/60" />
                              <span className="label-text">Auto-save tasks</span>
                            </div>
                            <input type="checkbox" className="toggle toggle-secondary" checked />
                          </label>
                        </div>
                        
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <div className="flex items-center gap-2">
                              <FontAwesomeIcon icon={faCog} className="w-4 h-4 text-base-content/60" />
                              <span className="label-text">Advanced mode</span>
                            </div>
                            <input type="checkbox" className="toggle toggle-accent" />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-semibold">Radio Groups</h4>
                      <div className="space-y-3">
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <span className="label-text">Light theme</span>
                            <input type="radio" name="theme-radio" className="radio radio-primary" />
                          </label>
                        </div>
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <span className="label-text">Dark theme</span>
                            <input type="radio" name="theme-radio" className="radio radio-primary" checked />
                          </label>
                        </div>
                        <div className="form-control">
                          <label className="label cursor-pointer">
                            <span className="label-text">Auto theme</span>
                            <input type="radio" name="theme-radio" className="radio radio-primary" />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Button Groups</h3>
                  
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-semibold mb-3">Toggle Group</h4>
                      <div className="join">
                        <button className="btn btn-active join-item">
                          <FontAwesomeIcon icon={faUser} className="w-4 h-4" />
                        </button>
                        <button className="btn join-item">
                          <FontAwesomeIcon icon={faRobot} className="w-4 h-4" />
                        </button>
                        <button className="btn join-item">
                          <FontAwesomeIcon icon={faTerminal} className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-3">Action Group</h4>
                      <div className="join">
                        <button className="btn btn-primary join-item">
                          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                          Start
                        </button>
                        <button className="btn btn-warning join-item">
                          <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
                          Pause
                        </button>
                        <button className="btn btn-error join-item">
                          <FontAwesomeIcon icon={faTerminal} className="w-4 h-4" />
                          Stop
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

        {/* Composition Guidelines */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Molecule Composition Guidelines</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-success">✓ Good Composition</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Combine 2-5 atoms for a single purpose</li>
                <li>• Use consistent spacing between atoms</li>
                <li>• Follow established patterns (icon + label)</li>
                <li>• Maintain single responsibility</li>
                <li>• Make molecules reusable across contexts</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-error">✗ Poor Composition</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Combining too many unrelated atoms</li>
                <li>• Creating molecules with multiple responsibilities</li>
                <li>• Inconsistent spacing or alignment</li>
                <li>• Hard-coding values instead of using tokens</li>
                <li>• Making molecules too specific to one use case</li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}