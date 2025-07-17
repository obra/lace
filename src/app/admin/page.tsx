import { Metadata } from 'next';
import Link from 'next/link';
import { 
  DocumentTextIcon, 
  SwatchIcon, 
  CogIcon,
  UserIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';

export const metadata: Metadata = {
  title: 'Admin - Lace',
  description: 'Admin interface for Lace AI coding assistant',
};

interface AdminCardProps {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

function AdminCard({ title, description, href, icon: Icon }: AdminCardProps) {
  return (
    <Link
      href={href}
      className="block p-6 bg-base-100 rounded-lg border border-base-300 hover:shadow-lg transition-shadow"
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 p-3 bg-primary/10 rounded-lg">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-2">{title}</h3>
          <p className="text-base-content/70 text-sm">{description}</p>
        </div>
      </div>
    </Link>
  );
}

export default function AdminPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Lace Admin</h1>
          <p className="text-base-content/70">
            Manage your Lace AI coding assistant configuration and settings
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <AdminCard
            title="Instructions Management"
            description="Edit user preferences and project-specific instructions for Claude Code"
            href="/admin/instructions"
            icon={DocumentTextIcon}
          />
          
          <AdminCard
            title="Design System"
            description="Browse and manage the component library and design tokens"
            href="/admin/design"
            icon={SwatchIcon}
          />
          
          <AdminCard
            title="User Settings"
            description="Configure personal preferences and default behaviors"
            href="/admin/settings"
            icon={UserIcon}
          />
          
          <AdminCard
            title="Developer Tools"
            description="Debug tools and development utilities"
            href="/admin/dev"
            icon={CodeBracketIcon}
          />
        </div>

        <div className="mt-12 p-6 bg-base-100 rounded-lg border border-base-300">
          <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
            <CogIcon className="w-5 h-5 text-primary" />
            Quick Actions
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Link
              href="/admin/instructions"
              className="btn btn-sm btn-outline"
            >
              Edit User Instructions
            </Link>
            <Link
              href="/admin/instructions"
              className="btn btn-sm btn-outline"
            >
              Edit Project Instructions
            </Link>
            <Link
              href="/admin/design/components"
              className="btn btn-sm btn-outline"
            >
              Browse Components
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}