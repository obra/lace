'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch,
  faTerminal,
  faTasks,
  faUser,
  faRobot,
  faCog,
  faPlus,
  faFolder,
} from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

// Import our actual molecular components to showcase them
import { NavigationItem, MessageBubble, ExpandableHeader } from '~/components/ui';

export function MoleculesClient() {
  const [activeTab, setActiveTab] = useState('molecules');
  const [searchValue, setSearchValue] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('dark');
  const [showAlert, setShowAlert] = useState(true);
  const [switchValue, setSwitchValue] = useState(false);
  const [autoSaveValue, setAutoSaveValue] = useState(true);
  const [advancedModeValue, setAdvancedModeValue] = useState(false);
  const [selectedThemeRadio, setSelectedThemeRadio] = useState('dark');
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  return (
    <div className="bg-base-100 rounded-lg border border-base-300">
      <div className="flex border-b border-base-300 overflow-x-auto">
        {[
          {
            id: 'molecules',
            label: 'Our Molecules',
            desc: 'NavigationItem, MessageBubble, etc.',
          },
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
        {/* Our Molecules */}
        {activeTab === 'molecules' && (
          <div className="space-y-8">
            {/* NavigationItem Molecule */}
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">
                NavigationItem Molecule
              </h3>
              <p className="text-base-content/70 mb-6">
                Composed from IconButton + Badge + StatusDot atoms. Used for sidebar navigation,
                menus, and lists.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">
                    Basic Navigation Items
                  </h4>
                  <div className="space-y-2 p-4 border border-base-300 rounded">
                    <NavigationItem
                      icon={faSearch}
                      title="Search"
                      isActive={false}
                      onClick={() => {}}
                    />
                    <NavigationItem
                      icon={faTerminal}
                      title="Terminal"
                      isActive={true}
                      onClick={() => {}}
                    />
                    <NavigationItem
                      icon={faTasks}
                      title="Tasks"
                      isActive={false}
                      onClick={() => {}}
                    />
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-base-content mb-3">
                    With Badges & Status
                  </h4>
                  <div className="space-y-2 p-4 border border-base-300 rounded">
                    <NavigationItem
                      icon={faFolder}
                      title="Projects"
                      isActive={false}
                      onClick={() => {}}
                      badge="3"
                    />
                    <NavigationItem
                      icon={faUser}
                      title="Profile"
                      isActive={false}
                      onClick={() => {}}
                      status="online"
                    />
                    <NavigationItem
                      icon={faRobot}
                      title="AI Assistant"
                      isActive={false}
                      onClick={() => {}}
                      badge="!"
                      status="busy"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* MessageBubble Molecule */}
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">
                MessageBubble Molecule
              </h3>
              <p className="text-base-content/70 mb-6">
                Composed from Avatar + Badge + formatted content. Used for chat messages,
                comments, and notifications.
              </p>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">
                    Chat Message Examples
                  </h4>
                  <div className="space-y-4 p-4 border border-base-300 rounded">
                    <MessageBubble
                      role="user"
                      header={{
                        name: "You",
                        timestamp: new Date().toLocaleTimeString()
                      }}
                    >
                      This is a user message with some **bold text** and `code`.
                    </MessageBubble>
                    <MessageBubble
                      role="assistant"
                      header={{
                        name: "Claude",
                        timestamp: new Date().toLocaleTimeString()
                      }}
                    >
                      This is an AI assistant response with helpful information.
                    </MessageBubble>
                    <MessageBubble
                      role="user"
                      header={{
                        name: "You",
                        timestamp: new Date().toLocaleTimeString()
                      }}
                    >
                      A longer message that might wrap to multiple lines and show how the bubble adapts to different content lengths.
                    </MessageBubble>
                  </div>
                </div>
              </div>
            </div>

            {/* ExpandableHeader Molecule */}
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">
                ExpandableHeader Molecule
              </h3>
              <p className="text-base-content/70 mb-6">
                Composed from IconButton + Badge + ChevronIcon atoms. Used for collapsible
                sections, accordions, and drawers.
              </p>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">
                    Collapsible Sections
                  </h4>
                  <div className="space-y-2 p-4 border border-base-300 rounded">
                    <ExpandableHeader
                      title="Projects"
                      isExpanded={projectsExpanded}
                      onToggle={() => setProjectsExpanded(!projectsExpanded)}
                      badge="5"
                    />
                    {projectsExpanded && (
                      <div className="ml-6 space-y-1 text-sm text-base-content/70">
                        <div>• Project Alpha</div>
                        <div>• Project Beta</div>
                        <div>• Project Gamma</div>
                      </div>
                    )}

                    <ExpandableHeader
                      title="Recent Activity"
                      isExpanded={activityExpanded}
                      onToggle={() => setActivityExpanded(!activityExpanded)}
                      badge="12"
                    />
                    {activityExpanded && (
                      <div className="ml-6 space-y-1 text-sm text-base-content/70">
                        <div>• File updated</div>
                        <div>• Task completed</div>
                        <div>• Message sent</div>
                      </div>
                    )}

                    <ExpandableHeader
                      title="Settings"
                      isExpanded={settingsExpanded}
                      onToggle={() => setSettingsExpanded(!settingsExpanded)}
                    />
                    {settingsExpanded && (
                      <div className="ml-6 space-y-1 text-sm text-base-content/70">
                        <div>• Theme preferences</div>
                        <div>• Notification settings</div>
                        <div>• Privacy controls</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Patterns */}
        {activeTab === 'navigation' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">Navigation Patterns</h3>
              <p className="text-base-content/70 mb-6">
                Common navigation molecules built from atomic components.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">Sidebar Navigation</h4>
                  <div className="space-y-2 p-4 border border-base-300 rounded bg-base-50">
                    <NavigationItem
                      icon={faSearch}
                      title="Dashboard"
                      isActive={true}
                      onClick={() => {}}
                    />
                    <NavigationItem
                      icon={faFolder}
                      title="Projects"
                      isActive={false}
                      onClick={() => {}}
                      badge="3"
                    />
                    <NavigationItem
                      icon={faTasks}
                      title="Tasks"
                      isActive={false}
                      onClick={() => {}}
                      badge="12"
                    />
                    <NavigationItem
                      icon={faUser}
                      title="Team"
                      isActive={false}
                      onClick={() => {}}
                      status="online"
                    />
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-base-content mb-3">Breadcrumb Navigation</h4>
                  <div className="p-4 border border-base-300 rounded bg-base-50">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-base-content/60">Home</span>
                      <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                      <span className="text-base-content/60">Projects</span>
                      <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
                      <span className="text-base-content font-medium">Project Alpha</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Form Patterns */}
        {activeTab === 'forms' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">Form Patterns</h3>
              <p className="text-base-content/70 mb-6">
                Input patterns combining labels, fields, and validation feedback.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">Search Input</h4>
                  <div className="p-4 border border-base-300 rounded">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        className="input input-bordered w-full pl-10"
                      />
                      <FontAwesomeIcon
                        icon={faSearch}
                        className="absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/60 w-4 h-4"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-base-content mb-3">Theme Selector</h4>
                  <div className="p-4 border border-base-300 rounded">
                    <select
                      value={selectedTheme}
                      onChange={(e) => setSelectedTheme(e.target.value)}
                      className="select select-bordered w-full"
                    >
                      <option value="light">Light Theme</option>
                      <option value="dark">Dark Theme</option>
                      <option value="auto">Auto Theme</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Feedback Patterns */}
        {activeTab === 'feedback' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">Feedback Patterns</h3>
              <p className="text-base-content/70 mb-6">
                Alert and notification molecules for user feedback.
              </p>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">Alert Messages</h4>
                  <div className="space-y-3 p-4 border border-base-300 rounded">
                    <AnimatePresence>
                      {showAlert && (
                        <motion.div
                          initial={{ opacity: 0, y: -20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          className="alert alert-success"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 bg-success rounded-full"></div>
                            <span>Operation completed successfully!</span>
                            <button
                              onClick={() => setShowAlert(false)}
                              className="btn btn-sm btn-circle btn-ghost ml-auto"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="alert alert-warning">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-warning rounded-full"></div>
                        <span>This action cannot be undone.</span>
                      </div>
                    </div>

                    <div className="alert alert-error">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-error rounded-full"></div>
                        <span>Something went wrong. Please try again.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content Patterns */}
        {activeTab === 'content' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">Content Patterns</h3>
              <p className="text-base-content/70 mb-6">
                Card and list molecules for displaying content.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">Info Cards</h4>
                  <div className="space-y-3 p-4 border border-base-300 rounded">
                    <div className="card card-compact bg-base-100 shadow">
                      <div className="card-body">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary/20 rounded flex items-center justify-center">
                            <FontAwesomeIcon icon={faTasks} className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold">Active Tasks</h3>
                            <p className="text-sm text-base-content/70">12 items</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="card card-compact bg-base-100 shadow">
                      <div className="card-body">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-secondary/20 rounded flex items-center justify-center">
                            <FontAwesomeIcon icon={faUser} className="w-4 h-4 text-secondary" />
                          </div>
                          <div>
                            <h3 className="font-semibold">Team Members</h3>
                            <p className="text-sm text-base-content/70">5 online</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-base-content mb-3">Status List</h4>
                  <div className="p-4 border border-base-300 rounded">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 p-2 rounded hover:bg-base-200">
                        <div className="w-2 h-2 bg-success rounded-full"></div>
                        <span className="text-sm">System operational</span>
                      </div>
                      <div className="flex items-center gap-3 p-2 rounded hover:bg-base-200">
                        <div className="w-2 h-2 bg-warning rounded-full"></div>
                        <span className="text-sm">Maintenance scheduled</span>
                      </div>
                      <div className="flex items-center gap-3 p-2 rounded hover:bg-base-200">
                        <div className="w-2 h-2 bg-info rounded-full"></div>
                        <span className="text-sm">New updates available</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Control Patterns */}
        {activeTab === 'controls' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-base-content mb-4">Control Patterns</h3>
              <p className="text-base-content/70 mb-6">
                Interactive control molecules for settings and preferences.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-base-content mb-3">Toggle Controls</h4>
                  <div className="space-y-4 p-4 border border-base-300 rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Enable notifications</div>
                        <div className="text-xs text-base-content/60">
                          Receive alerts for new messages
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={switchValue}
                        onChange={(e) => setSwitchValue(e.target.checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Auto-save</div>
                        <div className="text-xs text-base-content/60">
                          Automatically save changes
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="toggle toggle-secondary"
                        checked={autoSaveValue}
                        onChange={(e) => setAutoSaveValue(e.target.checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">Advanced mode</div>
                        <div className="text-xs text-base-content/60">
                          Enable advanced features
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="toggle toggle-accent"
                        checked={advancedModeValue}
                        onChange={(e) => setAdvancedModeValue(e.target.checked)}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-base-content mb-3">Radio Group</h4>
                  <div className="space-y-3 p-4 border border-base-300 rounded">
                    <div className="text-sm font-medium mb-2">Theme Selection</div>
                    {['light', 'dark', 'auto'].map((theme) => (
                      <div key={theme} className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="theme"
                          value={theme}
                          checked={selectedThemeRadio === theme}
                          onChange={(e) => setSelectedThemeRadio(e.target.value)}
                          className="radio radio-primary"
                        />
                        <label className="text-sm capitalize">{theme} theme</label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}