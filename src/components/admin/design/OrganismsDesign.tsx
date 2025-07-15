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
  faCheck,
  faStop,
  faFolder,
} from '~/lib/fontawesome';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HomeIcon,
  UserIcon,
  CogIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

// Import our actual organism components to showcase them
import {
  Modal,
  AnimatedModal,
  MessageBubble,
  NavigationItem,
  SidebarSection,
} from '~/components/ui';

export default function OrganismsDesign() {
  const [activeTab, setActiveTab] = useState('organisms');
  const [searchValue, setSearchValue] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('dark');
  const [showModal, setShowModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showNotification, setShowNotification] = useState(false);

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Organisms</h1>
          <p className="text-base-content/70 mb-4">
            Complex UI components composed of groups of molecules and/or atoms that form distinct
            sections of the interface.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-accent rounded-full"></div>
            <span>Complex components • Form distinct sections • Can contain many parts</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-base-100 rounded-lg border border-base-300">
          <div className="flex border-b border-base-300">
            {[
              {
                id: 'organisms',
                label: 'Current Organisms',
                desc: 'Our existing organism components',
              },
              {
                id: 'composition',
                label: 'Composition Examples',
                desc: 'How organisms are built from molecules and atoms',
              },
              { id: 'states', label: 'States & Variants', desc: 'Different looks and behaviors' },
              { id: 'accessibility', label: 'Accessibility', desc: 'Inclusive design patterns' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 p-4 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent border-b-2 border-accent'
                    : 'hover:bg-base-200'
                }`}
              >
                <div className="font-medium">{tab.label}</div>
                <div className="text-xs text-base-content/60">{tab.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Tab content */}
            {activeTab === 'organisms' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Card for each organism */}
                  <div className="card bg-base-100 border border-base-300 shadow-sm hover:shadow transition-shadow">
                    <div className="card-body">
                      <h3 className="card-title">Header</h3>
                      <p>Application top bar with navigation, search, and user controls.</p>
                      <div className="card-actions justify-end mt-4">
                        <button className="btn btn-primary btn-sm" onClick={() => {}}>
                          View Example
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card bg-base-100 border border-base-300 shadow-sm hover:shadow transition-shadow">
                    <div className="card-body">
                      <h3 className="card-title">Sidebar</h3>
                      <p>Navigation sidebar with collapsible sections and links.</p>
                      <div className="card-actions justify-end mt-4">
                        <button className="btn btn-primary btn-sm" onClick={() => {}}>
                          View Example
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card bg-base-100 border border-base-300 shadow-sm hover:shadow transition-shadow">
                    <div className="card-body">
                      <h3 className="card-title">Modal Dialog</h3>
                      <p>Overlay dialog for focused user interaction and forms.</p>
                      <div className="card-actions justify-end mt-4">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setShowModal(true)}
                        >
                          Open Example
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card bg-base-100 border border-base-300 shadow-sm hover:shadow transition-shadow">
                    <div className="card-body">
                      <h3 className="card-title">Command Palette</h3>
                      <p>Quick command interface for power users.</p>
                      <div className="card-actions justify-end mt-4">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setShowCommandPalette(true)}
                        >
                          Open Example
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'composition' && (
              <div className="space-y-8">
                <p className="text-base-content">
                  Content for the Composition Examples tab would go here.
                </p>
              </div>
            )}

            {activeTab === 'states' && (
              <div className="space-y-8">
                <p className="text-base-content">
                  Content for the States & Variants tab would go here.
                </p>
              </div>
            )}

            {activeTab === 'accessibility' && (
              <div className="space-y-8">
                <p className="text-base-content">
                  Content for the Accessibility tab would go here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
