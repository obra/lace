// ABOUTME: Composable Sidebar container component with flexible content slots
// ABOUTME: Provides layout, styling, and responsive behavior while allowing custom content composition

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ChevronRightIcon } from '@/lib/heroicons';
import { faCog, faComments } from '@/lib/fontawesome';
import * as Sentry from '@sentry/nextjs';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onSettingsClick?: () => void;
  children: React.ReactNode;
}

interface SidebarSectionProps {
  title: string;
  icon?: React.ComponentProps<typeof FontAwesomeIcon>['icon'];
  children: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

interface SidebarItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

interface SidebarButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function Sidebar({ isOpen, onToggle, onSettingsClick, children }: SidebarProps) {
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
  // Collapsed state
  if (!isOpen) {
    return (
      <>
        <div className="bg-base-100 border-r border-base-300/50 flex flex-col items-center py-6 transition-all duration-300 w-16 relative shadow-sm h-full">
          <div className="flex flex-col gap-3">
            <button
              onClick={onSettingsClick}
              className="p-3 hover:bg-base-200 rounded-xl transition-all duration-200 hover:scale-105 ring-hover"
              title="Settings"
            >
              <FontAwesomeIcon icon={faCog} className="w-5 h-5 text-base-content/60" />
            </button>
            <button
              onClick={openFeedbackModal}
              className="p-3 hover:bg-base-200 rounded-xl transition-all duration-200 hover:scale-105 ring-hover"
              title="Send Feedback"
            >
              <FontAwesomeIcon icon={faComments} className="w-5 h-5 text-base-content/60" />
            </button>
          </div>

          {/* Clickable border area for toggle */}
          <div
            className="absolute -right-2 top-0 bottom-0 w-4 cursor-pointer hover:bg-primary/10 transition-colors duration-200 z-40"
            onClick={onToggle}
            title="Click to expand sidebar"
          />

          <button
            onClick={onToggle}
            className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-lg z-[200] group"
          >
            <ChevronRightIcon className="w-4 h-4 text-base-content/60 group-hover:text-base-content transition-colors" />
          </button>

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

  return (
    <>
      <div className="bg-base-100/95 backdrop-blur-sm border-r border-base-300/50 flex flex-col relative transition-all duration-300 w-[350px] h-full shadow-lg">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-base-300/30">
            <div className="flex items-center justify-between">
              <div className="flex-1 gap-3">
                <Link
                  href="/"
                  className="flex items-center gap-3 font-semibold tracking-tight hover:opacity-80 transition-opacity"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-accent to-cyan-600 text-xs text-white shadow-md">
                    ✦
                  </span>
                  <span className="text-xl font-ui font-medium">Lace</span>
                </Link>
              </div>
              <button
                onClick={onSettingsClick}
                className="p-2.5 hover:bg-base-200/80 rounded-xl transition-all duration-200 hover:scale-105"
                title="Settings"
              >
                <FontAwesomeIcon
                  icon={faCog}
                  className="w-4 h-4 text-base-content/50 hover:text-base-content/80 transition-colors"
                />
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto">{children}</div>

          {/* Footer with Feedback Button */}
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

          {/* Clickable border area for toggle */}
          <div
            className="absolute -right-2 top-0 bottom-0 w-4 cursor-pointer hover:bg-primary/10 transition-colors duration-200 z-40 group"
            onClick={onToggle}
            title="Click to collapse sidebar"
          />

          {/* Toggle Button */}
          <button
            onClick={onToggle}
            className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-lg z-[200] group"
          >
            <ChevronRightIcon className="w-4 h-4 text-base-content/60 group-hover:text-base-content transition-colors rotate-180" />
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

export function SidebarSection({
  title,
  icon,
  children,
  collapsible = true,
  defaultCollapsed = false,
}: SidebarSectionProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  // Sync internal state with prop changes
  React.useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  return (
    <div className="px-6 py-4">
      <button
        onClick={() => collapsible && setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between text-sm font-medium text-base-content/60 mb-3 hover:text-base-content/80 transition-all duration-200 ${
          collapsible ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-2">
          {icon && <FontAwesomeIcon icon={icon} className="w-4 h-4" />}
          <span className="uppercase tracking-wider text-xs font-semibold">{title}</span>
        </div>
        {collapsible && (
          <ChevronRightIcon
            className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-0' : 'rotate-90'}`}
          />
        )}
      </button>

      {!collapsed && <div className="space-y-2 ml-1">{children}</div>}
    </div>
  );
}

export function SidebarItem({
  children,
  onClick,
  active = false,
  disabled = false,
  className = '',
}: SidebarItemProps) {
  const baseClasses =
    'w-full text-left py-3 px-4 rounded-xl text-sm transition-all duration-200 font-ui';
  const stateClasses = disabled
    ? 'text-base-content/40 cursor-not-allowed'
    : active
      ? 'bg-primary/90 text-primary-content shadow-sm ring-1 ring-primary/20 font-medium'
      : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content hover:scale-[1.02] hover:shadow-sm';

  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`${baseClasses} ${stateClasses} ${className}`}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function SidebarButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
}: SidebarButtonProps) {
  const baseClasses =
    'w-full border rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md';

  const variantClasses = {
    primary:
      'border-primary/80 bg-gradient-to-r from-primary to-primary/90 text-primary-content hover:from-primary/90 hover:to-primary hover:scale-[1.02]',
    secondary:
      'border-base-300/50 bg-base-200/80 text-base-content hover:bg-base-300/80 hover:border-base-300 hover:scale-[1.02]',
    ghost:
      'border-transparent bg-transparent text-base-content hover:bg-base-200/60 hover:scale-[1.02]',
  };

  const sizeClasses = {
    sm: 'p-2',
    md: 'p-3',
  };

  const stateClasses = disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

  return (
    <button
      onClick={disabled || loading ? undefined : onClick}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${stateClasses} ${className}`}
      disabled={disabled || loading}
    >
      {loading && <div className="loading loading-spinner loading-sm"></div>}
      {children}
    </button>
  );
}
