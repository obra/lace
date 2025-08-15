// ABOUTME: Login page component with password authentication and one-time token support
// ABOUTME: Handles user login, form validation, error display, and redirect functionality

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const router = useRouter();
  const searchParams = useSearchParams();

  // Handle one-time token from URL on component mount
  useEffect(() => {
    const handleTokenExchange = async (token: string) => {
      setIsLoading(true);
      setError('');

      try {
        const response = await fetch('/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (response.ok) {
          // Token exchange successful, redirect to home
          router.push('/');
        } else {
          const data = await response.json() as { error?: string };
          setError(data.error || 'Invalid or expired token');
        }
      } catch (_err) {
        setError('Network error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    const token = searchParams.get('token');
    if (token) {
      void handleTokenExchange(token);
    }
  }, [searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          rememberMe,
        }),
      });

      if (response.ok) {
        // Login successful - use Next.js router for better WebKit compatibility
        // Add delay to ensure cookie is processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Use Next.js router instead of window.location for WebKit compatibility
        router.push('/');
      } else {
        const data = await response.json() as { error?: string };
        setError(data.error || 'Login failed');
      }
    } catch (_err) {
      setError('Network error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  return (
    <div>
      <div className="text-center">
        <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
          Sign in to Lace
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Enter your password to access your workspace
        </p>
      </div>
      
      <form role="form" className="mt-8 space-y-6" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <div className="mt-1">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={handlePasswordChange}
              className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Enter your password"
              disabled={isLoading}
              data-testid="password-input"
            />
          </div>
        </div>

        <div className="flex items-center">
          <input
            id="remember-me"
            name="remember-me"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            disabled={isLoading}
            data-testid="remember-me"
          />
          <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
            Remember me for 30 days
          </label>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4" data-testid="error-message">
            <div className="text-sm text-red-800">
              {error}
            </div>
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={!password.trim() || isLoading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="login-button"
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>

        <div className="mt-6 text-center" data-testid="reset-password-info">
          <p className="text-sm text-gray-500">
            Password reset is only available via command line.
            <br />
            Run <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">lace --reset-password</code> to generate a new password.
          </p>
        </div>
      </form>
    </div>
  );
}