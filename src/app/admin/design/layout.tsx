import Link from 'next/link';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base-200">
      {/* Navigation */}
      <nav className="bg-base-100 border-b border-base-300 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 text-sm breadcrumbs">
            <Link href="/" className="text-primary hover:text-primary-focus">
              Lace
            </Link>
            <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
            <Link href="/admin" className="text-base-content/60 hover:text-base-content">
              Admin
            </Link>
            <ChevronRightIcon className="w-4 h-4 text-base-content/40" />
            <span className="text-base-content/60">Design System</span>
          </div>

          <div className="flex gap-4 mt-4">
            <Link href="/admin/instructions" className="btn btn-sm btn-ghost">
              Instructions
            </Link>
            <Link href="/admin/design" className="btn btn-sm btn-ghost btn-active">
              Design System
            </Link>
          </div>
          
          <div className="flex gap-2 mt-3 ml-4">
            <Link href="/admin/design" className="btn btn-xs btn-ghost">
              Overview
            </Link>
            <Link href="/admin/design/components" className="btn btn-xs btn-ghost">
              Implemented
            </Link>
            <Link href="/admin/design/missing" className="btn btn-xs btn-ghost">
              Missing Components
            </Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main>{children}</main>
    </div>
  );
}
