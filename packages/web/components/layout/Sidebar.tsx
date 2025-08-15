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
        }
      );

      setShowFeedbackModal(false);
      setFeedbackText('');
      setUserEmail('');

      // Show success message
      const successDialog = document.createElement('div');
      successDialog.className = 'toast toast-top toast-end';
      successDialog.innerHTML = `
        <div class="alert alert-success">
          <span>Thank you for your feedback!</span>
        </div>
      `;
      document.body.appendChild(successDialog);
      setTimeout(() => {
        document.body.removeChild(successDialog);
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
      <div className="bg-base-100 border-r border-base-300 flex flex-col items-center py-4 transition-all duration-300 w-16 relative">
        <div className="flex flex-col gap-2">
          <button
            onClick={onSettingsClick}
            className="p-2 hover:bg-base-200 rounded-lg transition-colors"
            title="Settings"
          >
            <FontAwesomeIcon icon={faCog} className="w-5 h-5 text-base-content/60" />
          </button>
          <button
            onClick={openFeedbackModal}
            className="p-2 hover:bg-base-200 rounded-lg transition-colors"
            title="Send Feedback"
          >
            <FontAwesomeIcon icon={faComments} className="w-5 h-5 text-base-content/60" />
          </button>
        </div>

        <button
          onClick={onToggle}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
        >
          <ChevronRightIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors" />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-base-100 border-r border-base-300 flex flex-col relative transition-all duration-300 w-[350px] h-full">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-base-300">
          <div className="flex items-center justify-between">
            <div className="flex-1 gap-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-emerald-300 to-cyan-800 text-xs text-neutral-200">
                  ✦
                </span>
                <span className="text-lg">Lace</span>
              </Link>
            </div>
            <button
              onClick={onSettingsClick}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
              title="Settings"
            >
              <FontAwesomeIcon icon={faCog} className="w-4 h-4 text-base-content/60" />
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

        {/* Toggle Button */}
        <button
          onClick={onToggle}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
        >
          <ChevronRightIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors rotate-180" />
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
              <p className="text-sm text-base-content/60">
                We&apos;ll only use this to follow up on your feedback if needed
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="border-t border-base-300 p-6 bg-base-50/50 flex gap-3 justify-end">
            <button
              className="btn btn-ghost btn-lg"
              onClick={() => {
                setShowFeedbackModal(false);
                setFeedbackText('');
                setUserEmail('');
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-lg min-w-[140px]"
              onClick={handleFeedbackSubmit}
              disabled={!feedbackText.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Sending...
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faComments} className="w-4 h-4" />
                  Send Feedback
                </>
              )}
            </button>
          </div>
        </div>
        <div
          className="modal-backdrop backdrop-blur-sm bg-black/30"
          onClick={() => setShowFeedbackModal(false)}
        ></div>
      </div>
    </div>
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
    <div className="px-4 py-3">
      <button
        onClick={() => collapsible && setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between text-sm font-medium text-base-content/70 mb-2 hover:text-base-content transition-colors ${
          collapsible ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-2">
          {icon && <FontAwesomeIcon icon={icon} className="w-4 h-4" />}
          <span className="uppercase tracking-wide">{title}</span>
        </div>
        {collapsible && (
          <ChevronRightIcon
            className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-0' : 'rotate-90'}`}
          />
        )}
      </button>

      {!collapsed && <div className="space-y-1">{children}</div>}
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
  const baseClasses = 'w-full text-left p-3 rounded-lg text-sm transition-colors';
  const stateClasses = disabled
    ? 'text-base-content/40 cursor-not-allowed'
    : active
      ? 'bg-primary text-primary-content'
      : 'text-base-content/80 hover:bg-base-200 hover:text-base-content';

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
    'w-full border rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2';

  const variantClasses = {
    primary: 'border-primary bg-primary text-primary-content hover:bg-primary/90',
    secondary: 'border-base-300 bg-base-200 text-base-content hover:bg-base-300',
    ghost: 'border-transparent bg-transparent text-base-content hover:bg-base-200',
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
