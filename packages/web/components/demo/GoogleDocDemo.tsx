'use client';

import { useState } from 'react';
import GoogleDocChatMessage from '@/components/organisms/GoogleDocChatMessage';
import type { Message } from '@/types';

interface GoogleDocAttachment {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  lastModified: Date;
  owner: string;
  permissions: 'view' | 'comment' | 'edit';
  preview?: string;
}

interface GoogleDocMessage extends Message {
  document?: GoogleDocAttachment;
}

export default function GoogleDocDemo() {
  const [selectedScenario, setSelectedScenario] = useState<string>('with-thumbnail');

  const baseMessage: Omit<GoogleDocMessage, 'document'> = {
    id: 'demo-1',
    role: 'user',
    content: 'Here is the project requirements document I mentioned:',
    timestamp: new Date(),
  };

  const scenarios: Record<string, GoogleDocMessage> = {
    'with-thumbnail': {
      ...baseMessage,
      document: {
        id: '12urC2W5rjN4mCbKCB3SL_gCcfJBYqn0qqdQMOHDCg9M',
        title: 'Live Google Doc - Dynamic OG Image',
        url: 'https://docs.google.com/document/d/12urC2W5rjN4mCbKCB3SL_gCcfJBYqn0qqdQMOHDCg9M/',
        lastModified: new Date('2024-07-10'),
        owner: 'sarah.chen@company.com',
        permissions: 'edit',
        preview:
          'This demonstrates dynamic OG image extraction from a live Google Docs URL. The component automatically fetches the Open Graph image using our meta scraper API, showing a real preview of the document content.',
      },
    },
    'no-thumbnail': {
      ...baseMessage,
      document: {
        id: '12urC2W5rjN4mCbKCB3SL_gCcfJBYqn0qqdQMOHDCg9M',
        title: 'Live Google Doc Example - No Thumbnail',
        url: 'https://docs.google.com/document/d/12urC2W5rjN4mCbKCB3SL_gCcfJBYqn0qqdQMOHDCg9M/',
        lastModified: new Date('2024-07-12'),
        owner: 'alex.rodriguez@company.com',
        permissions: 'comment',
        preview:
          'This is a live Google Docs document that demonstrates how the component handles real document links. You can click the "Open in Google Docs" button to view the actual document.\n\nThis scenario shows the fallback behavior when no thumbnail is provided by the Google Drive API.',
      },
    },
    'view-only': {
      ...baseMessage,
      document: {
        id: 'doc-789',
        title: 'Company Policy - Remote Work Guidelines',
        url: 'https://docs.google.com/document/d/5555555555/edit',
        lastModified: new Date('2024-06-15'),
        owner: 'hr@company.com',
        permissions: 'view',
        preview:
          'Remote Work Policy\n\nEffective Date: June 15, 2024\n\n1. Overview\nThis policy establishes guidelines for remote work arrangements to ensure productivity, collaboration, and work-life balance...',
      },
    },
    'assistant-response': {
      id: 'demo-2',
      role: 'assistant',
      content: "I've reviewed the document and created a summary of the key points:",
      timestamp: new Date(),
      document: {
        id: 'doc-summary',
        title: 'AI-Generated Project Summary',
        url: 'https://docs.google.com/document/d/ai-summary-123/edit',
        lastModified: new Date(),
        owner: 'lace-assistant@ai.com',
        permissions: 'edit',
        preview:
          'Key Points Summary:\n\n• Main goal: 25% improvement in user engagement\n• Target churn rate: <5%\n• Timeline: Q4 2024 completion\n• Priority features: Analytics dashboard, user onboarding flow\n• Budget allocation: $500K for development, $100K for infrastructure\n\nRisk Assessment:\n• Technical complexity: Medium-High\n• Resource availability: Adequate\n• Market readiness: High',
      },
    },
  };

  return (
    <div className="min-h-screen bg-base-100 p-6">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-base-content mb-2">Google Docs Message Demo</h1>
          <p className="text-base-content/70">
            Preview how Google Docs attachments appear in chat messages
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <div className="card bg-base-200 shadow-sm">
              <div className="card-body p-4">
                <h2 className="card-title text-lg mb-4">Scenarios</h2>
                <div className="space-y-2">
                  {Object.entries(scenarios).map(([key, _scenario]) => (
                    <button
                      key={key}
                      className={`btn btn-sm w-full justify-start ${
                        selectedScenario === key ? 'btn-primary' : 'btn-ghost'
                      }`}
                      onClick={() => setSelectedScenario(key)}
                    >
                      {key === 'with-thumbnail' && 'Dynamic OG Image'}
                      {key === 'no-thumbnail' && 'No Thumbnail'}
                      {key === 'view-only' && 'View Only'}
                      {key === 'assistant-response' && 'Assistant Response'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="card bg-base-200 shadow-sm">
              <div className="card-body p-6">
                <h2 className="card-title text-lg mb-4">Message Preview</h2>

                <div className="bg-base-100 border border-base-300 rounded-lg p-6 min-h-[400px]">
                  <GoogleDocChatMessage message={scenarios[selectedScenario]} />
                </div>

                <div className="mt-6 pt-4 border-t border-base-300">
                  <h3 className="font-semibold mb-2">Current Scenario Details</h3>
                  <div className="bg-base-300 rounded-lg p-3 font-mono text-sm">
                    <div className="text-xs text-base-content/60 mb-2">Message Properties:</div>
                    <div>
                      Role: <span className="text-accent">{scenarios[selectedScenario].role}</span>
                    </div>
                    <div>
                      Has Document:{' '}
                      <span className="text-accent">
                        {scenarios[selectedScenario].document ? 'Yes' : 'No'}
                      </span>
                    </div>
                    {scenarios[selectedScenario].document && (
                      <>
                        <div>
                          Permissions:{' '}
                          <span className="text-accent">
                            {scenarios[selectedScenario].document?.permissions}
                          </span>
                        </div>
                        <div>
                          Has Thumbnail:{' '}
                          <span className="text-accent">
                            {scenarios[selectedScenario].document?.thumbnailUrl ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div>
                          Preview Length:{' '}
                          <span className="text-accent">
                            {scenarios[selectedScenario].document?.preview?.length || 0} chars
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Integration Notes */}
        <div className="mt-8 card bg-info/10 border border-info/20">
          <div className="card-body p-6">
            <h2 className="card-title text-info mb-4">Integration Instructions</h2>
            <div className="prose prose-sm max-w-none text-base-content/80">
              <p>To integrate this component into your main chat interface:</p>
              <ol>
                <li>
                  Add a <code>google-doc</code> type to your <code>TimelineEntry</code> interface
                </li>
                <li>
                  Update <code>TimelineMessage</code> component to handle the new message type
                </li>
                <li>Modify your message processing logic to detect Google Docs links</li>
                <li>Implement Google Docs API integration to fetch document metadata</li>
              </ol>

              <h3 className="font-semibold mt-4 mb-2">Dynamic OG Image Extraction</h3>
              <p className="text-sm text-base-content/70">
                The component now automatically extracts Open Graph images from any Google Docs URL:
              </p>
              <ul className="text-sm text-base-content/70 mt-2 space-y-1">
                <li>
                  <strong>Auto-detection:</strong> Detects Google Docs URLs and fetches OG metadata
                </li>
                <li>
                  <strong>Meta Scraper API:</strong> Server-side endpoint extracts{' '}
                  <code>&lt;meta property=&quot;og:image&quot;&gt;</code> tags
                </li>
                <li>
                  <strong>Loading States:</strong> Shows skeleton loader while fetching metadata
                </li>
                <li>
                  <strong>Fallback:</strong> FontAwesome <code>faFileText</code> icon when no image
                  available
                </li>
                <li>
                  <strong>Error Handling:</strong> Graceful degradation on fetch failures
                </li>
              </ul>
              <p className="text-sm text-base-content/60 mt-2">
                The &quot;Dynamic OG Image&quot; scenario demonstrates real-time OG image extraction from the
                live Google Doc URL.
              </p>

              <p className="text-sm text-base-content/60 mt-4">
                This demo shows how the component renders with different permission levels,
                thumbnail availability, and user roles (user vs assistant messages).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
