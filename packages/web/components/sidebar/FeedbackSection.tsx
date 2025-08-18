// ABOUTME: Standalone feedback section component with modal functionality
// ABOUTME: Provides feedback collection UI for sidebar components using Sentry integration

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments } from '@/lib/fontawesome';
import * as Sentry from '@sentry/nextjs';

interface FeedbackSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
}

export function FeedbackSection({ isMobile = false, onCloseMobileNav }: FeedbackSectionProps) {
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

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

      setShowFeedbackModal(false);
      setFeedbackText('');
      setUserEmail('');

      // Show React-based success toast
      setShowSuccessToast(true);
      setTimeout(() => {
        setShowSuccessToast(false);
      }, 3000);

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
        <div className="modal-box max-w-lg p-0 bg-base-100 shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-8 pb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                <FontAwesomeIcon icon={faComments} className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-base-content">Share Your Feedback</h3>
            </div>
            <p className="text-base-content/70 text-lg">
              Help us make Lace better with your thoughts, bug reports, or feature ideas.
            </p>
          </div>

          {/* Form Content */}
          <div className="p-8 pt-6 space-y-6">
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-semibold text-base-content/90 mb-2 block">
                  What&apos;s on your mind?
                </span>
                <textarea
                  className="textarea textarea-bordered w-full h-32 resize-none text-base placeholder:text-base-content/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="Share your experience, report bugs, suggest features, or just let us know how we're doing..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  disabled={isSubmitting}
                  data-sentry-mask
                />
              </label>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-semibold text-base-content/90 mb-2 block">
                  Email <span className="text-base-content/50 font-normal">(optional)</span>
                </span>
                <input
                  type="email"
                  className="input input-bordered w-full text-base placeholder:text-base-content/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="your.email@example.com"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  disabled={isSubmitting}
                />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="btn btn-outline flex-1"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleFeedbackSubmit}
                className="btn btn-primary flex-1"
                disabled={!feedbackText.trim() || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
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

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="toast toast-top toast-end">
          <div className="alert alert-success">
            <span>Thank you for your feedback!</span>
          </div>
        </div>
      )}
    </>
  );
}
