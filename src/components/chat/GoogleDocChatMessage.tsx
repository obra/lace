import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileText,
  faExternalLink,
  faExpand,
  faCompress,
  faUser,
  faRobot,
  faEye,
  faComment,
  faEdit,
} from '@fortawesome/free-solid-svg-icons';
import { useOgImage } from '~/hooks/useOgImage';
import { isGoogleDocsUrl } from '~/utils/urlUtils';
import { DocumentSkeleton } from '~/components/ui/SkeletonLoader';
import type { Message } from '~/types';

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

  // Fetch OG image if this is a Google Docs URL and no thumbnail is provided
  const shouldFetchOgImage =
    message.document && isGoogleDocsUrl(message.document.url) && !message.document.thumbnailUrl;

  const { imageUrl: ogImageUrl, isLoading: ogImageLoading } = useOgImage(
    shouldFetchOgImage ? message.document?.url : undefined
  );

  // Use provided thumbnail URL or fetched OG image
  const thumbnailUrl = message.document?.thumbnailUrl || ogImageUrl;

  const handleDocumentClick = () => {
    if (message.document?.url) {
      window.open(message.document.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleThumbnailError = () => {
    setImageError(true);
  };

  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0">
        <div
          className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${
            message.role === 'user' ? 'bg-teal-600 text-white' : 'bg-orange-500 text-white'
          }`}
        >
          <FontAwesomeIcon icon={message.role === 'user' ? faUser : faRobot} className="text-xs" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-medium text-sm text-base-content">
            {message.role === 'user' ? 'You' : 'Lace'}
          </span>
          <span className="text-xs text-base-content/50">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>

        {/* Text content */}
        {message.content && (
          <div className="text-sm leading-relaxed text-base-content mb-3">{message.content}</div>
        )}

        {/* Google Doc attachment */}
        {message.document && (
          <div className="border border-base-300 rounded-lg overflow-hidden bg-base-100">
            {ogImageLoading ? (
              <div className="p-3">
                <DocumentSkeleton />
              </div>
            ) : (
              <>
                {/* Document header */}
                <div className="p-3 bg-base-200 border-b border-base-300">
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faFileText} className="text-blue-600 text-sm" />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate" title={message.document.title}>
                        {message.document.title}
                      </h4>
                      <p className="text-xs text-base-content/70">
                        By {message.document.owner} •{' '}
                        {message.document.lastModified.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          message.document.permissions === 'edit'
                            ? 'bg-green-100 text-green-700'
                            : message.document.permissions === 'comment'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {message.document.permissions}
                      </span>
                      <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="btn btn-ghost btn-xs"
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <FontAwesomeIcon
                          icon={isExpanded ? faCompress : faExpand}
                          className="text-xs"
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Document preview */}
                <div className="p-3">
                  {/* Thumbnail or fallback */}
                  {thumbnailUrl && !imageError ? (
                    <div className="mb-3">
                      <img
                        src={thumbnailUrl}
                        alt={`Preview of ${message.document.title}`}
                        className="w-full h-32 object-cover rounded border border-base-300"
                        onError={handleThumbnailError}
                      />
                    </div>
                  ) : (
                    <div className="mb-3 w-full h-32 bg-base-200 rounded border border-base-300 flex items-center justify-center">
                      <FontAwesomeIcon
                        icon={faFileText}
                        className="text-4xl text-base-content/30"
                      />
                    </div>
                  )}

                  {/* Text preview */}
                  {message.document.preview && (
                    <div className="mb-3">
                      <p
                        className={`text-sm text-base-content/80 ${!isExpanded ? 'line-clamp-3' : ''}`}
                      >
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
                    <button onClick={handleDocumentClick} className="btn btn-primary btn-sm">
                      <FontAwesomeIcon icon={faExternalLink} className="mr-1" />
                      Open in Google Docs
                    </button>
                    <div className="flex items-center gap-1 text-xs text-base-content/60">
                      {message.document.permissions === 'view' && (
                        <>
                          <FontAwesomeIcon icon={faEye} />
                          <span>View only</span>
                        </>
                      )}
                      {message.document.permissions === 'comment' && (
                        <>
                          <FontAwesomeIcon icon={faComment} />
                          <span>Can comment</span>
                        </>
                      )}
                      {message.document.permissions === 'edit' && (
                        <>
                          <FontAwesomeIcon icon={faEdit} />
                          <span>Can edit</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
