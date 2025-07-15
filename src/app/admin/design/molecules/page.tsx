import { MoleculesClient } from '~/components/admin/design/MoleculesClient';

export default function MoleculesPage() {
  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Molecules</h1>
          <p className="text-base-content/70 mb-4">
            Simple groups of atoms functioning together as a unit. Each molecule has a single, clear
            responsibility and combines 2-5 atoms to solve specific UI patterns.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-secondary rounded-full"></div>
            <span>Composed of atoms • Single responsibility • Reusable patterns</span>
          </div>
        </div>

        <MoleculesClient />
      </div>
    </div>
  );
}
