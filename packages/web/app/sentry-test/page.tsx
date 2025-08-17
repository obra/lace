// ABOUTME: Test page for verifying Sentry error reporting functionality
// ABOUTME: Provides buttons to trigger client and server-side errors for testing
'use client';

import * as Sentry from '@sentry/nextjs';

export default function SentryTestPage() {
  const triggerClientError = () => {
    throw new Error('Test client-side error for Sentry');
  };

  const triggerServerError = async () => {
    try {
      const response = await fetch('/api/sentry-test', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Server error test failed');
      }
    } catch (error) {
      console.error('Server error test:', error);
    }
  };

  const captureMessage = () => {
    Sentry.captureMessage('Test message from Lace web app', 'info');
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Sentry Test Page</h1>
      <div className="space-y-4">
        <button
          onClick={triggerClientError}
          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
        >
          Trigger Client Error
        </button>
        
        <button
          onClick={triggerServerError}
          className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600"
        >
          Trigger Server Error
        </button>
        
        <button
          onClick={captureMessage}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Capture Test Message
        </button>
      </div>
    </div>
  );
}