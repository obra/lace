// ABOUTME: Tab navigation component for settings modal with keyboard accessibility
// ABOUTME: Manages tab switching and content display for organized settings panels

'use client';

import React, { useState, useEffect, useRef, Children, cloneElement, isValidElement } from 'react';

interface TabConfig {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface SettingsTabsProps {
  defaultTab: string;
  onTabChange?: (tabId: string) => void;
  children: React.ReactNode;
  tabs?: TabConfig[];
}

export function SettingsTabs({ defaultTab, onTabChange, children, tabs }: SettingsTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const tabsRef = useRef<HTMLButtonElement[]>([]);

  // Extract tab IDs from children or use provided tabs config
  const childrenArray = Children.toArray(children);

  // Type guard for elements with data-tab prop
  const isElementWithDataTab = (
    node: React.ReactNode
  ): node is React.ReactElement<{ 'data-tab': string }> => {
    return (
      isValidElement(node) &&
      typeof node.props === 'object' &&
      node.props !== null &&
      'data-tab' in node.props &&
      typeof (node.props as Record<string, unknown>)['data-tab'] === 'string'
    );
  };

  const tabIds = tabs
    ? tabs.map((tab) => tab.id)
    : childrenArray
        .filter(isElementWithDataTab)
        .map((child) => child.props['data-tab'])
        .filter((id): id is string => typeof id === 'string' && Boolean(id));

  // Generate tab labels if not provided
  const tabConfigs: TabConfig[] =
    tabs ||
    tabIds.map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      icon: undefined,
    }));

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    onTabChange?.(tabId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let newIndex = currentIndex;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        newIndex = (currentIndex + 1) % tabConfigs.length;
        break;
      case 'ArrowLeft':
        event.preventDefault();
        newIndex = currentIndex === 0 ? tabConfigs.length - 1 : currentIndex - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        handleTabClick(tabConfigs[currentIndex].id);
        return;
      default:
        return;
    }

    tabsRef.current[newIndex]?.focus();
  };

  // Find active content
  const activeContent = childrenArray
    .filter(isElementWithDataTab)
    .find((child) => child.props['data-tab'] === activeTab);

  return (
    <div className="flex flex-col h-full">
      {/* Tab navigation */}
      <div className="border-b border-base-300/70 bg-base-100/40 backdrop-blur-sm">
        <nav className="flex space-x-0 px-2" role="tablist">
          {tabConfigs.map((tab, index) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) tabsRef.current[index] = el;
                }}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-0 ${
                  isActive
                    ? 'border-accent text-accent bg-accent/5'
                    : 'border-transparent text-base-content/70 hover:text-base-content hover:border-base-300/70'
                }`}
                onClick={() => handleTabClick(tab.id)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              >
                {tab.icon && (
                  <span className="mr-2 inline-flex items-center text-accent/90">{tab.icon}</span>
                )}
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeContent && (
          <div
            id={`tabpanel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
            className="h-full overflow-y-auto"
          >
            {activeContent}
          </div>
        )}
      </div>
    </div>
  );
}
