// ABOUTME: Composable Sidebar container component with flexible content slots
// ABOUTME: Provides layout, styling, and responsive behavior while allowing custom content composition

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ChevronRightIcon } from '@/lib/heroicons';
import { faCog } from '@/lib/fontawesome';

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
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center shadow-lg overflow-hidden relative">
                <div className="absolute inset-0 opacity-20">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px), repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)`,
                    }}
                  ></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white/30 rounded transform rotate-45"></div>
                  <div className="absolute w-3 h-3 border border-white/20 rounded transform rotate-45"></div>
                </div>
              </div>
              <span className="font-semibold text-base-content">Lace</span>
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
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>


        {/* Toggle Button */}
        <button
          onClick={onToggle}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-base-100 border border-base-300 rounded-full flex items-center justify-center hover:bg-base-200 transition-all duration-200 shadow-md z-10 group"
        >
          <ChevronRightIcon className="w-3 h-3 text-base-content/60 group-hover:text-base-content transition-colors rotate-180" />
        </button>
      </div>
    </div>
  );
}

export function SidebarSection({ title, icon, children, collapsible = true, defaultCollapsed = false }: SidebarSectionProps) {
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
      
      {!collapsed && (
        <div className="space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

export function SidebarItem({ children, onClick, active = false, disabled = false, className = '' }: SidebarItemProps) {
  const baseClasses = "w-full text-left p-3 rounded-lg text-sm transition-colors";
  const stateClasses = disabled 
    ? "text-base-content/40 cursor-not-allowed"
    : active 
    ? "bg-primary text-primary-content"
    : "text-base-content/80 hover:bg-base-200 hover:text-base-content";

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
  className = ''
}: SidebarButtonProps) {
  const baseClasses = "w-full border rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2";
  
  const variantClasses = {
    primary: "border-primary bg-primary text-primary-content hover:bg-primary/90",
    secondary: "border-base-300 bg-base-200 text-base-content hover:bg-base-300",
    ghost: "border-transparent bg-transparent text-base-content hover:bg-base-200"
  };

  const sizeClasses = {
    sm: "p-2",
    md: "p-3"
  };

  const stateClasses = disabled || loading
    ? "opacity-50 cursor-not-allowed"
    : "cursor-pointer";

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