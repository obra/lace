// ABOUTME: Unified responsive Sidebar component handling both mobile and desktop layouts
// ABOUTME: Uses single open/onToggle API with automatic mobile overlay vs desktop panel behavior

'use client';

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ChevronRightIcon } from '@/lib/heroicons';
import { faCog, faTimes, faBars } from '@/lib/fontawesome';

interface SidebarProps {
  open: boolean;
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
  headerActions?: React.ReactNode;
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

export function Sidebar({ open, onToggle, onSettingsClick, children }: SidebarProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <>
      {/* Mobile version - overlay when open */}
      <div className="lg:hidden">
        <AnimatePresence>
          {isClient && open && (
            <>
              {/* Mobile backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-40"
                onClick={onToggle}
              />

              {/* Mobile sidebar */}
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed left-0 top-0 h-full w-80 bg-base-100 z-50 flex flex-col"
              >
                {/* Mobile Header */}
                <div className="p-4 border-b border-base-300">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 gap-3">
                      <Link
                        href="/"
                        className="flex items-center gap-2 font-semibold tracking-tight"
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-content">
                          ✦
                        </span>
                        <span className="text-lg">Lace</span>
                      </Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onToggle}
                        className="p-2 hover:bg-base-200 rounded-lg transition-colors"
                        aria-label="Close sidebar"
                      >
                        <FontAwesomeIcon icon={faTimes} className="w-5 h-5 text-base-content/60" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mobile Content Area */}
                <div className="flex-1 overflow-y-auto">{children}</div>

                {/* Mobile Footer */}
                <div className="p-4 border-t border-base-300">
                  <button
                    onClick={onSettingsClick}
                    className="btn btn-ghost w-full justify-start"
                    aria-label="Open settings"
                    data-testid="settings-button-mobile"
                  >
                    <FontAwesomeIcon icon={faCog} className="w-4 h-4 mr-2" />
                    Settings
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Desktop version - always rendered, but collapsed when !open */}
      <div className="hidden lg:block h-full">
        <DesktopSidebar open={open} onToggle={onToggle} onSettingsClick={onSettingsClick}>
          {children}
        </DesktopSidebar>
      </div>

      {/* Mobile hamburger - only show when sidebar is closed */}
      {isClient && !open && (
        <button
          className="fixed top-4 left-4 z-30 lg:hidden p-2 bg-base-100 rounded-lg shadow-lg border border-base-300"
          onClick={onToggle}
          aria-label="Open sidebar"
        >
          <FontAwesomeIcon icon={faBars} className="w-5 h-5 text-base-content/60" />
        </button>
      )}
    </>
  );
}

function DesktopSidebar({
  open,
  onToggle,
  onSettingsClick,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onSettingsClick?: () => void;
  children: React.ReactNode;
}) {
  // Collapsed state
  if (!open) {
    return (
      <div className="bg-base-100 border-r border-base-300/50 flex flex-col items-center py-6 transition-all duration-300 w-16 relative shadow-sm h-full">
        <div className="flex flex-col gap-3">
          <button
            onClick={onSettingsClick}
            className="p-3 hover:bg-base-200 rounded-xl transition-all duration-200 hover:scale-105 ring-hover"
            aria-label="Open settings"
            data-testid="settings-button"
          >
            <FontAwesomeIcon icon={faCog} className="w-5 h-5 text-base-content/60" />
          </button>
        </div>

        {/* Clickable border area for toggle */}
        <button
          className="absolute -right-2 top-0 bottom-0 w-4 cursor-pointer hover:bg-primary/10 transition-colors duration-200 z-40 border-none bg-transparent"
          onClick={onToggle}
          aria-label="Expand sidebar"
        />

        <button
          onClick={onToggle}
          className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-lg z-[9999] group"
          aria-label="Expand sidebar"
        >
          <ChevronRightIcon className="w-4 h-4 text-base-content/60 group-hover:text-base-content transition-colors" />
        </button>
      </div>
    );
  }

  // Expanded state
  return (
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
              aria-label="Open settings"
              data-testid="settings-button"
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

        {/* Clickable border area for toggle */}
        <button
          className="absolute -right-2 top-0 bottom-0 w-4 cursor-pointer hover:bg-primary/10 transition-colors duration-200 z-40 group border-none bg-transparent"
          onClick={onToggle}
          aria-label="Collapse sidebar"
        />

        {/* Toggle Button */}
        <button
          onClick={onToggle}
          className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-lg z-[9999] group"
          aria-label="Collapse sidebar"
        >
          <ChevronRightIcon className="w-4 h-4 text-base-content/60 group-hover:text-base-content transition-colors rotate-180" />
        </button>
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
  headerActions,
}: SidebarSectionProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  // Sync internal state with prop changes
  React.useEffect(() => {
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  return (
    <div className="px-6 py-4">
      <div className="w-full flex items-center justify-between text-sm font-medium text-base-content/60 mb-3">
        <button
          onClick={() => collapsible && setCollapsed(!collapsed)}
          className={`flex items-center gap-2 hover:text-base-content/80 transition-all duration-200 ${
            collapsible ? 'cursor-pointer' : 'cursor-default'
          }`}
          aria-label={
            collapsible ? `${collapsed ? 'Expand' : 'Collapse'} ${title} section` : undefined
          }
          aria-expanded={collapsible ? !collapsed : undefined}
        >
          {icon && <FontAwesomeIcon icon={icon} className="w-4 h-4" />}
          <span className="uppercase tracking-wider text-xs font-semibold">{title}</span>
        </button>
        <div className="flex items-center gap-2">
          {headerActions}
          {collapsible && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hover:text-base-content/80 transition-colors"
              aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title} section`}
              aria-expanded={!collapsed}
            >
              <ChevronRightIcon
                className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-0' : 'rotate-90'}`}
              />
            </button>
          )}
        </div>
      </div>

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
