// ABOUTME: Reusable component for showing technical details in a consistent style
// ABOUTME: Used by both ToolCallDisplay and TimelineMessage for showing raw data

'use client';

import { useState, ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck } from '@/lib/fontawesome';

interface TechnicalDetailsToggleProps {
  details: unknown;
  label?: string;
  className?: string;
  buttonClassName?: string;
  children?: ReactNode;
}

export function TechnicalDetailsToggle({ 
  details, 
  label = 'Event Details',
  className = '',
  buttonClassName = '',
  children
}: TechnicalDetailsToggleProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    const detailsJson = JSON.stringify(details, null, 2);
    navigator.clipboard.writeText(detailsJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className={className}>
      {children}
      
      <button
        onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        className={buttonClassName || "text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200"}
      >
        {showTechnicalDetails ? 'Hide' : 'Show'} Details
      </button>
      
      {showTechnicalDetails && (
        <div className="mt-2 px-3 py-2 bg-base-50 border border-base-200 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-base-content/70 font-medium">{label}:</div>
            <button
              onClick={handleCopy}
              className="text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200 flex items-center gap-1"
            >
              <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-xs" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="text-xs font-mono text-base-content/80 whitespace-pre-wrap bg-base-100 p-2 rounded border">
            {JSON.stringify(details, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}