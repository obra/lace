import { OrganismsClient } from '~/components/admin/design/OrganismsClient';

export default function OrganismsPage() {
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

        <OrganismsClient />

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