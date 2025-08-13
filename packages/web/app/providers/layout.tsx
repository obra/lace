// ABOUTME: Layout for provider management section with navigation
// ABOUTME: Provides consistent header and navigation structure

import Link from 'next/link';

export default function ProvidersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Provider Management</h1>
        <div className="text-sm breadcrumbs">
          <ul>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>Providers</li>
          </ul>
        </div>
      </div>

      <div className="flex gap-4 border-b border-base-300">
        <Link href="/providers" className="tab tab-active">
          Configured Instances
        </Link>
        <Link href="/providers/catalog" className="tab">
          Browse Catalog
        </Link>
      </div>

      {children}
    </div>
  );
}
