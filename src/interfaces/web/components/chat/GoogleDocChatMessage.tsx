// ABOUTME: Enhanced chat message component with Google Docs attachment support
// ABOUTME: Displays document previews, thumbnails, and document interaction capabilities

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileAlt, faExternalLinkAlt } from '~/interfaces/web/lib/fontawesome';
import { Avatar } from '~/interfaces/web/components/ui';
import type { Message } from '~/interfaces/web/types';

interface GoogleDocAttachment {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  lastModified: Date;
  owner: string;
  permissions: 'view' | 'comment' | 'edit';
  preview?: string; // First few lines of content
}

interface GoogleDocMessage extends Message {
  document?: GoogleDocAttachment;
}

interface GoogleDocChatMessageProps {
  message: GoogleDocMessage;
}

export default function GoogleDocChatMessage({ message }: GoogleDocChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleDocumentClick = () => {
    if (message.document?.url) {
      window.open(message.document.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleThumbnailError = () => {
    setImageError(true);
  };

  return (
    <div className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
      <Avatar role={message.role} />
      <div className="chat-header">
        {message.role === 'user' ? 'You' : 'Lace'}
        <time className="text-xs opacity-50 ml-1">
          {message.timestamp.toLocaleTimeString()}
        </time>
      </div>
      
      <div
        className={`chat-bubble ${
          message.role === 'user' ? 'chat-bubble-primary' : 'chat-bubble-secondary'
        } max-w-md`}
      >
        {/* Text content */}
        {message.content && (
          <div className="mb-3">
            {message.content}
          </div>
        )}

        {/* Google Doc attachment */}
        {message.document && (
          <div className="border border-base-300 rounded-lg overflow-hidden bg-base-100">
            {/* Document header */}
            <div className="p-3 bg-base-200 border-b border-base-300">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon 
                  icon={faFileAlt} 
                  className="text-blue-600 text-sm" 
                />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate" title={message.document.title}>
                    {message.document.title}
                  </h4>
                  <p className="text-xs text-base-content/70">
                    By {message.document.owner} • {message.document.lastModified.toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    message.document.permissions === 'edit' 
                      ? 'bg-green-100 text-green-700' 
                      : message.document.permissions === 'comment'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {message.document.permissions}
                  </span>
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="btn btn-ghost btn-xs"
                    title={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <FontAwesomeIcon 
                      icon={faFileAlt} 
                      className="text-xs" 
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Document preview */}
            <div className="p-3">
              {/* Thumbnail or fallback */}
              {message.document.thumbnailUrl && !imageError ? (
                <div className="mb-3">
                  <img
                    src={message.document.thumbnailUrl}
                    alt={`Preview of ${message.document.title}`}
                    className="w-full h-32 object-cover rounded border border-base-300"
                    onError={handleThumbnailError}
                  />
                </div>
              ) : (
                <div className="mb-3 w-full h-32 bg-base-200 rounded border border-base-300 flex items-center justify-center">
                  <FontAwesomeIcon icon={faFileAlt} className="text-4xl text-base-content/30" />
                </div>
              )}

              {/* Text preview */}
              {message.document.preview && (
                <div className="mb-3">
                  <p className={`text-sm text-base-content/80 ${
                    !isExpanded ? 'line-clamp-3' : ''
                  }`}>
                    {message.document.preview}
                  </p>
                  {!isExpanded && message.document.preview.length > 150 && (
                    <p className="text-xs text-base-content/60 mt-1">
                      Click expand to see more...
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-between items-center">
                <button
                  onClick={handleDocumentClick}
                  className="btn btn-primary btn-sm"
                >
                  <FontAwesomeIcon icon={faExternalLinkAlt} className="mr-1" />
                  Open in Google Docs
                </button>
                <div className="text-xs text-base-content/60">
                  {message.document.permissions === 'view' && '👁️ View only'}
                  {message.document.permissions === 'comment' && '💬 Can comment'}
                  {message.document.permissions === 'edit' && '✏️ Can edit'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}