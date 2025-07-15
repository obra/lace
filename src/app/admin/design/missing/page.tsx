import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faRobot } from '~/lib/fontawesome';
import Link from 'next/link';
import { MissingClient } from '~/components/admin/design/MissingClient';

export default function MissingComponentsPage() {
  const missingComponents = {
    atoms: [
      { name: 'Waveform bars', priority: 'medium' as const, usage: 'Voice recognition UI', teal: true },
      { name: 'Progress indicators', priority: 'low' as const, usage: 'Loading states', teal: true },
      { name: 'Tooltip primitives', priority: 'low' as const, usage: 'Information overlay', teal: false },
    ],
    molecules: [
      { name: 'Voice waveform display', priority: 'medium' as const, usage: 'Enhanced voice input', teal: true },
      { name: 'File upload dropzone', priority: 'medium' as const, usage: 'Drag & drop files', teal: true },
      { name: 'Integration status badge', priority: 'high' as const, usage: 'External service status', teal: true },
      { name: 'Carousel navigation dots', priority: 'high' as const, usage: 'Timeline carousels', teal: true },
    ],
    organisms: [
      { name: 'Timeline Carousel System', priority: 'high' as const, usage: 'Code changes, file lists', teal: true },
      { name: 'Integration Timeline Entries', priority: 'high' as const, usage: 'Google Drive, Slack posts', teal: true },
      { name: 'Modal System', priority: 'medium' as const, usage: 'Task board, file manager', teal: true },
      { name: 'Command Palette', priority: 'medium' as const, usage: 'Quick actions (Cmd+K)', teal: true },
      { name: 'Enhanced Voice Panel', priority: 'medium' as const, usage: 'Mobile-optimized voice UI', teal: true },
    ],
    templates: [
      { name: 'Carousel layout patterns', priority: 'high' as const, usage: 'Horizontal scrolling content', teal: true },
      { name: 'Modal overlay templates', priority: 'medium' as const, usage: 'Dialog and panel layouts', teal: true },
      { name: 'Integration card layouts', priority: 'high' as const, usage: 'External service cards', teal: true },
    ]
  };

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Missing Components</h1>
          <p className="text-base-content/70 mb-4">
            YAGNI-focused components needed to complete our atomic design system, organized by implementation priority and backend integration requirements.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/admin/design" className="btn btn-primary btn-sm">
              ← Back to Design System
            </Link>
            <div className="text-sm text-base-content/60">
              Prioritized by immediate backend integration needs
            </div>
          </div>
        </div>

        <MissingClient missingComponents={missingComponents} />

        {/* Design System Integration */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Design System Integration</h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3">Teal Branding Focus</h3>
              <div className="space-y-2 text-sm text-base-content/80">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-teal-500 rounded"></div>
                  <span>Primary brand color for all new components</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-teal-100 border border-teal-300 rounded"></div>
                  <span>Light teal for backgrounds and subtle highlights</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-teal-600 rounded"></div>
                  <span>Dark teal for text and interactive elements</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-base-content mb-3">Square-ish Avatar Pattern</h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-md bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
                  <FontAwesomeIcon icon={faUser} className="text-xs" />
                </div>
                <div className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center text-sm">
                  <FontAwesomeIcon icon={faRobot} className="text-xs" />
                </div>
                <span className="text-sm text-base-content/70">rounded-md instead of rounded-full</span>
              </div>
              <p className="text-sm text-base-content/70">
                All new components should follow the square-ish avatar pattern for consistency with the existing timeline system.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}