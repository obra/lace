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
} from '~/lib/fontawesome';
import { ChevronRightIcon, Bars3Icon } from '@heroicons/react/24/outline';
import Link from 'next/link';

interface MissingComponent {
  name: string;
  priority: 'high' | 'medium' | 'low';
  usage: string;
  teal: boolean;
}

interface MissingComponents {
  atoms: MissingComponent[];
  molecules: MissingComponent[];
  organisms: MissingComponent[];
  templates: MissingComponent[];
}

interface MissingClientProps {
  missingComponents: MissingComponents;
}

export function MissingClient({ missingComponents }: MissingClientProps) {
  const [activeTab, setActiveTab] = useState('priority');

  const priorityOrder: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
  const priorityColors: Record<'high' | 'medium' | 'low', string> = {
    high: 'bg-teal-100 text-teal-800 border-teal-200',
    medium: 'bg-orange-100 text-orange-800 border-orange-200',
    low: 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return (
    <div className="bg-base-100 rounded-lg border border-base-300">
      <div className="flex border-b border-base-300">
        {[
          { id: 'priority', label: 'By Priority', desc: 'Implementation order' },
          { id: 'atomic', label: 'By Atomic Level', desc: 'Design system hierarchy' },
          { id: 'roadmap', label: 'Sprint Roadmap', desc: 'Development timeline' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 p-4 text-left transition-colors ${
              activeTab === tab.id
                ? 'bg-teal/10 text-teal-600 border-b-2 border-teal-600'
                : 'hover:bg-base-200'
            }`}
          >
            <div className="font-medium">{tab.label}</div>
            <div className="text-xs text-base-content/60">{tab.desc}</div>
          </button>
        ))}
      </div>

      <div className="p-6">
        {/* Priority View */}
        {activeTab === 'priority' && (
          <div className="space-y-8">
            {priorityOrder.map((priority) => (
              <div key={priority}>
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded-full border ${priorityColors[priority]}`}
                  >
                    {priority.toUpperCase()} PRIORITY
                  </span>
                  <h2 className="text-xl font-bold text-base-content capitalize">
                    {priority} Priority Components
                  </h2>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(missingComponents).flatMap(([level, components]) =>
                    components
                      .filter((comp: MissingComponent) => comp.priority === priority)
                      .map((component: MissingComponent, index: number) => (
                        <div
                          key={`${level}-${index}`}
                          className="border border-base-300 rounded-lg p-4 hover:border-teal-300 transition-colors"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-semibold text-base-content">{component.name}</h3>
                            {component.teal && (
                              <div
                                className="w-3 h-3 bg-teal-500 rounded-full"
                                title="Uses teal branding"
                              ></div>
                            )}
                          </div>
                          <p className="text-sm text-base-content/70 mb-2">{component.usage}</p>
                          <div className="flex items-center justify-between">
                            <span className="badge badge-outline badge-sm capitalize">{level}</span>
                            <Link
                              href={`/admin/design/${level}`}
                              className="text-xs text-teal-600 hover:text-teal-700"
                            >
                              View {level} →
                            </Link>
                          </div>
                        </div>
                      ))
                  )}
                </div>

                {priority === 'high' && (
                  <div className="mt-4 p-4 bg-teal-50 border border-teal-200 rounded-lg">
                    <h3 className="font-semibold text-teal-800 mb-2">Sprint 1 Focus</h3>
                    <p className="text-sm text-teal-700">
                      These high-priority components are essential for the carousel timeline system
                      and external integrations. They directly support backend features for code
                      change tracking and service integrations.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Atomic Level View */}
        {activeTab === 'atomic' && (
          <div className="space-y-8">
            {Object.entries(missingComponents).map(([level, components]) => (
              <div key={level}>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm
                    ${
                      level === 'atoms'
                        ? 'bg-primary/10 text-primary'
                        : level === 'molecules'
                          ? 'bg-secondary/10 text-secondary'
                          : level === 'organisms'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-info/10 text-info'
                    }`}
                  >
                    {level[0].toUpperCase()}
                  </div>
                  <h2 className="text-xl font-bold text-base-content capitalize">{level}</h2>
                  <Link href={`/admin/design/${level}`} className="btn btn-sm btn-outline">
                    View Current {level}
                  </Link>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {components.map((component: MissingComponent, index: number) => (
                    <div key={index} className="border border-base-300 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-base-content">{component.name}</h3>
                        <div className="flex items-center gap-2">
                          {component.teal && (
                            <div
                              className="w-3 h-3 bg-teal-500 rounded-full"
                              title="Uses teal branding"
                            ></div>
                          )}
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded border ${priorityColors[component.priority as keyof typeof priorityColors]}`}
                          >
                            {component.priority}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-base-content/70">{component.usage}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-3 bg-base-200 rounded-lg text-sm">
                  <strong>Level Purpose:</strong>
                  {level === 'atoms' && " Basic building blocks that can't be broken down further"}
                  {level === 'molecules' &&
                    ' Simple combinations of atoms for specific UI patterns'}
                  {level === 'organisms' && ' Complex, standalone sections with business logic'}
                  {level === 'templates' && ' Layout patterns and structural arrangements'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sprint Roadmap */}
        {activeTab === 'roadmap' && (
          <div className="space-y-8">
            <div className="border border-teal-300 rounded-lg bg-teal-50 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-teal-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <h2 className="text-xl font-bold text-teal-800">Sprint 1: Carousel Foundation</h2>
                <span className="badge bg-teal-600 text-white">Current Sprint</span>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-teal-800 mb-3">Core Components</h3>
                  <ul className="space-y-2 text-sm text-teal-700">
                    <li className="flex items-center gap-2">
                      <ChevronRightIcon className="w-4 h-4" />
                      Timeline Carousel System (organism)
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRightIcon className="w-4 h-4" />
                      Carousel navigation dots (molecule)
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRightIcon className="w-4 h-4" />
                      Carousel layout patterns (template)
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-teal-800 mb-3">Backend Integration</h3>
                  <ul className="space-y-2 text-sm text-teal-700">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                      File change detection
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                      Git integration for code changes
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                      Impact analysis data
                    </li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 p-4 bg-white/50 rounded border border-teal-200">
                <h4 className="font-semibold text-teal-800 mb-2">Success Criteria</h4>
                <div className="grid md:grid-cols-3 gap-4 text-sm text-teal-700">
                  <div>✓ Horizontal scrolling carousels</div>
                  <div>✓ Touch/swipe support</div>
                  <div>✓ Keyboard navigation</div>
                </div>
              </div>
            </div>

            <div className="border border-orange-300 rounded-lg bg-orange-50 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-orange-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <h2 className="text-xl font-bold text-orange-800">
                  Sprint 2: External Integrations
                </h2>
                <span className="badge bg-orange-600 text-white">Next Sprint</span>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-orange-800 mb-3">Integration Components</h3>
                  <ul className="space-y-2 text-sm text-orange-700">
                    <li className="flex items-center gap-2">
                      <ChevronRightIcon className="w-4 h-4" />
                      Integration Timeline Entries (organism)
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRightIcon className="w-4 h-4" />
                      Integration status badges (molecule)
                    </li>
                    <li className="flex items-center gap-2">
                      <ChevronRightIcon className="w-4 h-4" />
                      Integration card layouts (template)
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-orange-800 mb-3">Services Supported</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-orange-700">
                      <div className="w-6 h-6 bg-blue-500 rounded text-white text-xs flex items-center justify-center">
                        📊
                      </div>
                      Google Drive
                    </div>
                    <div className="flex items-center gap-2 text-orange-700">
                      <div className="w-6 h-6 bg-green-500 rounded text-white text-xs flex items-center justify-center">
                        📊
                      </div>
                      Google Sheets
                    </div>
                    <div className="flex items-center gap-2 text-orange-700">
                      <div className="w-6 h-6 bg-teal-500 rounded text-white text-xs flex items-center justify-center">
                        #
                      </div>
                      Slack
                    </div>
                    <div className="flex items-center gap-2 text-orange-700">
                      <div className="w-6 h-6 bg-gray-800 rounded text-white text-xs flex items-center justify-center">
                        🐙
                      </div>
                      GitHub
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border border-gray-300 rounded-lg bg-gray-50 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-gray-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <h2 className="text-xl font-bold text-gray-800">Sprint 3+: Enhanced Features</h2>
                <span className="badge bg-gray-600 text-white">Future</span>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="text-center p-4 border border-gray-300 rounded">
                  <h3 className="font-semibold text-gray-800 mb-2">Modal System</h3>
                  <p className="text-sm text-gray-600">Task board, file manager, command palette</p>
                </div>
                <div className="text-center p-4 border border-gray-300 rounded">
                  <h3 className="font-semibold text-gray-800 mb-2">Voice Enhancement</h3>
                  <p className="text-sm text-gray-600">Waveform display, mobile optimization</p>
                </div>
                <div className="text-center p-4 border border-gray-300 rounded">
                  <h3 className="font-semibold text-gray-800 mb-2">Advanced Interactions</h3>
                  <p className="text-sm text-gray-600">Drag & drop, advanced animations</p>
                </div>
              </div>

              <div className="mt-4 p-3 bg-gray-100 rounded text-sm text-gray-700">
                <strong>YAGNI Principle:</strong> These features will only be implemented when
                specific user workflows demand them and clear backend requirements are defined.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
