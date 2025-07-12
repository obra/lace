// ABOUTME: Reusable test utilities and helpers for web interface components
// ABOUTME: Common test setup, mocks, and assertion helpers to reduce code duplication

import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';

// Mock FontAwesome icons for testing since they're just decorative
export const MockFontAwesome = ({ icon, className, ...props }: any) => (
  <svg 
    data-testid="font-awesome-icon" 
    data-icon={icon?.iconName || 'unknown'}
    className={className}
    role="img"
    {...props}
  />
);

// Custom render function that provides common wrappers
export const renderWithDefaults = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  return render(ui, {
    ...options,
  });
};

// Helper to create mock timeline entries
export const createMockTimelineEntry = (overrides = {}) => ({
  id: 'test-entry-1',
  type: 'human' as const,
  content: 'Test message',
  timestamp: new Date('2024-01-01T12:00:00Z'),
  agent: 'Claude',
  ...overrides,
});

// Helper to check if element has specific CSS classes
export const hasClasses = (element: Element | null, classes: string[]) => {
  if (!element) return false;
  return classes.every(cls => element.classList.contains(cls));
};

// Helper to find elements by partial class name
export const findByPartialClass = (container: Element, partialClass: string) => {
  return container.querySelector(`[class*="${partialClass}"]`);
};