'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faSearch,
  faTerminal,
  faTable,
  faFile,
  faCheckCircle,
  faInfoCircle,
  faStop,
} from '~/lib/fontawesome';
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

interface AtomicLevel {
  id: string;
  name: string;
  description: string;
  examples: string[];
  status: 'complete' | 'partial' | 'planned';
  count: number;
}

interface DesignSystemClientProps {
  atomicLevels: AtomicLevel[];
}

export function DesignSystemClient({ atomicLevels }: DesignSystemClientProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['atoms']));

  const toggleSection = (id: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSections(newExpanded);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-success/20 text-success border-success/30';
      case 'partial':
        return 'bg-warning/20 text-warning border-warning/30';
      case 'planned':
        return 'bg-info/20 text-info border-info/30';
      default:
        return 'bg-base-300/20 text-base-content border-base-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return faCheckCircle;
      case 'partial':
        return faInfoCircle;
      case 'planned':
        return faStop;
      default:
        return faStop;
    }
  };

  const getLevelIcon = (id: string) => {
    switch (id) {
      case 'atoms':
        return faPlus;
      case 'molecules':
        return faSearch;
      case 'organisms':
        return faTerminal;
      case 'templates':
        return faTable;
      case 'pages':
        return faFile;
      default:
        return faPlus;
    }
  };

  return (
    <>
      {/* Atomic Levels Overview */}
      <div className="space-y-4">
        {atomicLevels.map((level) => (
          <div
            key={level.id}
            className="bg-base-100 rounded-lg border border-base-300 overflow-hidden"
          >
            <button
              onClick={() => toggleSection(level.id)}
              className="w-full p-6 text-left hover:bg-base-200/50 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={getLevelIcon(level.id)} className="w-6 h-6 text-primary" />
                  <div>
                    <h3 className="text-xl font-bold text-base-content">{level.name}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full border flex items-center gap-1 ${getStatusColor(level.status)}`}
                      >
                        <FontAwesomeIcon icon={getStatusIcon(level.status)} className="w-3 h-3" />
                        {level.status}
                      </span>
                      <span className="text-sm text-base-content/60">{level.count} components</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/admin/design/${level.id}`}
                  className="btn btn-sm btn-outline btn-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  View {level.name}
                </Link>
                {expandedSections.has(level.id) ? (
                  <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4 text-base-content/60" />
                )}
              </div>
            </button>

            {expandedSections.has(level.id) && (
              <div className="px-6 pb-6 border-t border-base-300">
                <div className="pt-4">
                  <p className="text-base-content/80 mb-4">{level.description}</p>

                  <div>
                    <h4 className="font-medium text-base-content mb-3">Examples in this level:</h4>
                    <div className="grid md:grid-cols-2 gap-2">
                      {level.examples.map((example, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-sm text-base-content/70"
                        >
                          <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                          <span>{example}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-base-200 rounded-lg">
                    <div className="text-xs text-base-content/60 uppercase tracking-wide font-medium mb-1">
                      Component Philosophy
                    </div>
                    <div className="text-sm text-base-content/80">
                      {level.id === 'atoms' &&
                        'Single-purpose, highly reusable. These are the core building blocks that everything else is built from.'}
                      {level.id === 'molecules' &&
                        'Simple combinations that solve specific UI patterns. Each molecule has one clear responsibility.'}
                      {level.id === 'organisms' &&
                        'Complex, standalone sections that could exist independently. Often contain business logic.'}
                      {level.id === 'templates' &&
                        'Layout patterns that define structure without content. Focus on responsive behavior and composition.'}
                      {level.id === 'pages' &&
                        'Complete user experiences with real content and full functionality.'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Component Stats Summary */}
      <div className="bg-base-100 rounded-lg border border-base-300 p-6">
        <h2 className="text-2xl font-bold text-base-content mb-4">Component System Status</h2>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-success mb-2">
              {atomicLevels.filter((l) => l.status === 'complete').length}
            </div>
            <div className="text-sm text-base-content/60">Complete Levels</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-warning mb-2">
              {atomicLevels.filter((l) => l.status === 'partial').length}
            </div>
            <div className="text-sm text-base-content/60">In Progress</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary mb-2">
              {atomicLevels.reduce((sum, l) => sum + l.count, 0)}
            </div>
            <div className="text-sm text-base-content/60">Total Components</div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-lg">
          <h3 className="font-semibold text-teal-800 mb-2">
            <FontAwesomeIcon icon={faCheckCircle} className="w-4 h-4 mr-2" />
            Foundation Complete
          </h3>
          <p className="text-sm text-teal-700">
            Our component system follows atomic design principles with clean separation between
            presentation (atoms/molecules) and business logic (organisms/pages).
          </p>
        </div>
      </div>
    </>
  );
}
