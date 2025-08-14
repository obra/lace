// ABOUTME: Layout for login page providing minimal container without main app navigation
// ABOUTME: Clean layout focused on authentication without distracting elements

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In - Lace',
  description: 'Sign in to your Lace account',
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {children}
      </div>
    </div>
  );
}