// ABOUTME: Main page component for Lace web interface
// ABOUTME: Entry point that will integrate with shared Agent/ThreadManager instances

import React from 'react';
import { ChatInterface } from '../components/ChatInterface.js';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Lace AI Coding Assistant
          </h1>
          <p className="text-gray-600 mt-2">
            Web interface powered by event-sourcing architecture
          </p>
        </header>
        
        <ChatInterface />
      </div>
    </main>
  );
}