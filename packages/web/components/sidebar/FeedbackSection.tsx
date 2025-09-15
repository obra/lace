// ABOUTME: Standalone feedback section component with modal functionality
// ABOUTME: Provides feedback collection UI for sidebar components using Sentry integration

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments } from '@/lib/fontawesome';
import * as Sentry from '@sentry/react';
import { api } from '@/lib/api-client';
import { Alert } from '@/components/ui/Alert';

interface FeedbackSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
}

export function FeedbackSection({ isMobile = false, onCloseMobileNav }: FeedbackSectionProps) {
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);

  // Load user email from settings when modal opens
  const loadUserEmail = useCallback(async () => {
    if (userEmail) return; // Don't reload if already set

    try {
      setIsLoadingSettings(true);
      const settings = await api.get<Record<string, unknown>>('/api/settings');
      if (settings.email && typeof settings.email === 'string') {
        setUserEmail(settings.email);
      }
    } catch (error) {
      console.warn('Failed to load user email from settings:', error);
    } finally {
      setIsLoadingSettings(false);
    }
  }, [userEmail]);

  // Handle escape key to close modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showFeedbackModal) {
        setShowFeedbackModal(false);
      }
    },
    [showFeedbackModal]
  );

  // Add/remove escape key listener
  useEffect(() => {
    if (showFeedbackModal) {
      document.addEventListener('keydown', handleKeyDown);
      void loadUserEmail(); // Load email when modal opens
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showFeedbackModal, handleKeyDown, loadUserEmail]);

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) return;

    setIsSubmitting(true);

    try {
      await Sentry.startSpan(
        {
          op: 'ui.action',
          name: 'Submit Feedback',
        },
        async () => {
          Sentry.captureFeedback({
            message: feedbackText.trim(),
            name: userEmail ? 'Lace User' : undefined,
            email: userEmail.trim() || undefined,
          });

          // Ensure feedback is sent before continuing
          await Sentry.flush(2000);
        }
      );

      // Clear form and show success alert
      setFeedbackText('');
      setShowSuccessAlert(true);
      setTimeout(() => {
        setShowSuccessAlert(false);
        setShowFeedbackModal(false);
      }, 2000);

      // Close mobile nav if this is mobile
      if (isMobile && onCloseMobileNav) {
        onCloseMobileNav();
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openFeedbackModal = () => {
    Sentry.startSpan(
      {
        op: 'ui.click',
        name: 'Open Feedback Modal',
      },
      () => {
        setShowFeedbackModal(true);
      }
    );
  };

  return (
    <>
      {/* Feedback Button */}
      <div className="p-4 border-t border-base-300">
        <button
          onClick={openFeedbackModal}
          className="w-full flex items-center gap-3 p-3 hover:bg-base-200 rounded-lg transition-colors text-left"
          title="Send Feedback"
        >
          <FontAwesomeIcon icon={faComments} className="w-4 h-4 text-base-content/60" />
          <span className="text-sm text-base-content/80">Send Feedback</span>
        </button>
      </div>

      {/* Feedback Modal */}
      <div className={`modal ${showFeedbackModal ? 'modal-open' : ''}`}>
        <div className="modal-box max-w-md p-0 bg-base-100 shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-6 pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                <FontAwesomeIcon icon={faComments} className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-base-content">Share Your Feedback</h3>
            </div>
            <p className="text-base-content/70 text-sm">
              Help us make Lace better with your thoughts, bug reports, or feature ideas.
            </p>
          </div>

          {/* Form Content */}
          <div className="p-6 pt-4 space-y-4">
            <div className="space-y-2">
              <label className="block">
                <span className="text-sm font-medium text-base-content/90 mb-1 block">
                  What&apos;s on your mind?
                </span>
                <textarea
                  className="textarea textarea-bordered w-full h-24 resize-none text-sm placeholder:text-base-content/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="Share your experience, report bugs, suggest features..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  disabled={isSubmitting || isLoadingSettings}
                  data-sentry-mask
                />
              </label>
            </div>

            <div className="space-y-2">
              <label className="block">
                <span className="text-sm font-medium text-base-content/90 mb-1 block">
                  Email <span className="text-base-content/50 font-normal">(optional)</span>
                </span>
                <input
                  type="email"
                  className="input input-bordered w-full text-sm placeholder:text-base-content/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder={isLoadingSettings ? 'Loading...' : 'your.email@example.com'}
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  disabled={isSubmitting || isLoadingSettings}
                />
              </label>
            </div>

            {/* Success Alert */}
            {showSuccessAlert && (
              <Alert
                variant="success"
                title="Thank you for your feedback!"
                style="soft"
                className="text-sm"
              />
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="btn btn-outline btn-sm flex-1"
                disabled={isSubmitting || isLoadingSettings || showSuccessAlert}
              >
                Cancel
              </button>
              <button
                onClick={handleFeedbackSubmit}
                className="btn btn-primary btn-sm flex-1"
                disabled={
                  !feedbackText.trim() || isSubmitting || isLoadingSettings || showSuccessAlert
                }
              >
                {isSubmitting ? (
                  <>
                    <span className="loading loading-spinner loading-xs"></span>
                    Sending...
                  </>
                ) : (
                  'Send Feedback'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
