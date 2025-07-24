# Settings UI Implementation Plan

## Overview

This plan implements a comprehensive settings UI to replace the current theme selector embedded in the sidebar footer. The goal is to create a proper settings modal with multiple sections while following YAGNI principles and TDD methodology.

## Prerequisites & Context

### Codebase Knowledge Required
- **Framework**: React 18 with TypeScript 5.6+ in strict mode
- **Styling**: DaisyUI + Tailwind CSS with 9 predefined themes
- **Import Style**: Use `@/` path aliases, omit file extensions
- **File Headers**: All files must start with `// ABOUTME:` comments explaining purpose

### Critical TypeScript Rules
- **NEVER use `any` type** - Use `unknown` with type guards instead
- **Strict mode required** - All code must pass TypeScript strict compilation
- **Type safety first** - Prefer explicit typing over inference when unclear

### Testing Philosophy
- **TDD Required**: Write failing tests first, then implement
- **NEVER mock functionality under test** - Use real codepaths
- **Real data/APIs only** - No mocks in integration/e2e tests
- **Test file location**: Co-located with source (e.g., `component.test.tsx` next to `component.tsx`)

### Development Workflow
- **Frequent commits** - Commit after each working feature/test
- **Pre-commit hooks** - Linting, formatting, tests run automatically
- **Never skip hooks** - Pre-commit hooks cannot be bypassed

## Current State Analysis

### Files to Understand
1. **packages/web/components/layout/Sidebar.tsx** (lines 102-104)
   - Contains ThemeSelector in footer
   - Has unused settings button (line 56)
   - Theme props: `currentTheme`, `onThemeChange`

2. **packages/web/components/ui/ThemeSelector.tsx**
   - Self-contained theme selection with 9 DaisyUI themes
   - localStorage persistence with 'theme' key
   - Visual color swatches for each theme
   - Controlled/uncontrolled mode support

3. **packages/web/components/config/SessionConfigPanel.tsx**
   - Existing comprehensive modal pattern to follow
   - Shows proper modal structure and state management

## Implementation Tasks

### Task 1: Create Base Settings Components

**Objective**: Establish foundational components for settings UI

**Files to Create**:
- `packages/web/components/settings/SettingsModal.tsx`
- `packages/web/components/settings/SettingsTabs.tsx`
- `packages/web/components/settings/SettingsPanel.tsx`
- `packages/web/components/settings/SettingField.tsx`

**Files to Update**:
- `packages/web/components/settings/index.ts` (create barrel export)

**TDD Steps**:
1. **Write failing test** for SettingsModal:
   ```typescript
   // packages/web/components/settings/SettingsModal.test.tsx
   import { render, screen } from '@testing-library/react';
   import { SettingsModal } from './SettingsModal';

   describe('SettingsModal', () => {
     it('renders modal when open', () => {
       render(<SettingsModal isOpen={true} onClose={() => {}} />);
       expect(screen.getByRole('dialog')).toBeInTheDocument();
       expect(screen.getByText('Settings')).toBeInTheDocument();
     });

     it('does not render when closed', () => {
       render(<SettingsModal isOpen={false} onClose={() => {}} />);
       expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
     });
   });
   ```

2. **Run test** - should fail with module not found
3. **Implement SettingsModal**:
   ```typescript
   // packages/web/components/settings/SettingsModal.tsx
   // ABOUTME: Main settings modal container with backdrop and close functionality
   // ABOUTME: Provides consistent modal structure for all settings panels

   'use client';

   import React from 'react';

   interface SettingsModalProps {
     isOpen: boolean;
     onClose: () => void;
     children?: React.ReactNode;
   }

   export function SettingsModal({ isOpen, onClose, children }: SettingsModalProps) {
     if (!isOpen) return null;

     return (
       <div className="fixed inset-0 z-50 flex items-center justify-center">
         <div 
           className="fixed inset-0 bg-black/50 backdrop-blur-sm"
           onClick={onClose}
         />
         <div 
           role="dialog"
           className="relative bg-base-100 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden"
         >
           <div className="flex items-center justify-between p-6 border-b border-base-300">
             <h2 className="text-xl font-semibold text-base-content">Settings</h2>
             <button
               onClick={onClose}
               className="btn btn-ghost btn-sm btn-circle"
             >
               ✕
             </button>
           </div>
           <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
             {children}
           </div>
         </div>
       </div>
     );
   }
   ```

4. **Run test** - should now pass
5. **Commit**: "feat: add base SettingsModal component with tests"

**Repeat TDD cycle** for SettingsTabs, SettingsPanel, and SettingField components.

**Testing Commands**:
```bash
npm test -- --watch packages/web/components/settings/
npm run test:coverage -- packages/web/components/settings/
```

**Acceptance Criteria**:
- [x] All components render correctly
- [x] Modal opens/closes properly
- [x] TypeScript compilation passes
- [x] Tests achieve >90% coverage (33 tests passing)
- [x] Accessibility attributes present (role, aria-labels)

**✅ COMPLETED**: Base settings components implemented with comprehensive TDD approach:
- SettingsModal: Main modal with backdrop, keyboard navigation (Escape), accessibility
- SettingsTabs: Tab navigation with full keyboard support (arrows, Enter/Space)
- SettingsPanel: Base panel with title, description, icon support
- SettingField: Field wrapper with horizontal/vertical layouts, required indicators
- Complete Storybook stories for SettingsModal demonstrating usage patterns
- Barrel export index.ts for clean imports
- Integration tests verify all components work together

### Task 2: Create UI Settings Panel with Theme Selector ✅

**Objective**: Move theme selector from sidebar to proper settings location

**Files to Create**:
- `packages/web/components/settings/panels/UISettingsPanel.tsx`
- `packages/web/components/settings/panels/UISettingsPanel.test.tsx`

**Files to Update**:
- `packages/web/components/ui/ThemeSelector.tsx` (minor props adjustment if needed)

**TDD Steps**:
1. **Write failing test**:
   ```typescript
   // packages/web/components/settings/panels/UISettingsPanel.test.tsx
   import { render, screen, fireEvent } from '@testing-library/react';
   import { UISettingsPanel } from './UISettingsPanel';

   describe('UISettingsPanel', () => {
     it('renders theme selector', () => {
       render(<UISettingsPanel />);
       expect(screen.getByText('Theme')).toBeInTheDocument();
       expect(screen.getByText('light')).toBeInTheDocument();
       expect(screen.getByText('dark')).toBeInTheDocument();
     });

     it('calls onThemeChange when theme selected', () => {
       const mockOnThemeChange = jest.fn();
       render(<UISettingsPanel onThemeChange={mockOnThemeChange} />);
       
       fireEvent.click(screen.getByText('light'));
       expect(mockOnThemeChange).toHaveBeenCalledWith('light');
     });
   });
   ```

2. **Implement UISettingsPanel**:
   ```typescript
   // packages/web/components/settings/panels/UISettingsPanel.tsx
   // ABOUTME: UI-specific settings panel containing theme selector and display preferences
   // ABOUTME: Handles theme changes and visual customization options

   'use client';

   import React from 'react';
   import { ThemeSelector } from '@/components/ui/ThemeSelector';
   import { SettingsPanel } from '../SettingsPanel';
   import { SettingField } from '../SettingField';

   interface UISettingsPanelProps {
     currentTheme?: string;
     onThemeChange?: (theme: string) => void;
   }

   export function UISettingsPanel({ currentTheme, onThemeChange }: UISettingsPanelProps) {
     return (
       <SettingsPanel title="UI Settings">
         <SettingField
           label="Theme"
           description="Choose your preferred color theme"
         >
           <ThemeSelector 
             currentTheme={currentTheme}
             onThemeChange={onThemeChange}
           />
         </SettingField>
       </SettingsPanel>
     );
   }
   ```

**Testing Strategy**:
- Test theme selection functionality
- Test theme persistence (localStorage interaction)
- Test visual theme application (DOM attribute changes)
- Integration test with real ThemeSelector component

**Commit**: "feat: add UISettingsPanel with theme selector"

**✅ COMPLETED**: UISettingsPanel successfully implemented with TDD approach:
- UISettingsPanel component integrating ThemeSelector within SettingsPanel structure
- 7 comprehensive tests covering theme selection, integration, and UI behavior
- Storybook stories showcasing various usage patterns (Default, LightTheme, ColorfulThemes, InModal, Interactive, AllThemes)
- Barrel export updated to include UISettingsPanel
- Fixed ThemeSelector React import issue for proper test execution
- All tests passing (40 total across settings components)

### Task 3: Update Sidebar to Remove Theme Selector ✅

**Objective**: Clean up sidebar by removing embedded theme selector and connecting settings button

**Files to Update**:
- `packages/web/components/layout/Sidebar.tsx`
- `packages/web/components/layout/Sidebar.test.tsx` (if exists)

**TDD Steps**:
1. **Write test for settings button functionality**:
   ```typescript
   // Add to existing Sidebar.test.tsx or create new
   it('calls onSettingsClick when settings button clicked', () => {
     const mockOnSettingsClick = jest.fn();
     render(
       <Sidebar 
         isOpen={true} 
         onToggle={() => {}} 
         onSettingsClick={mockOnSettingsClick}
       />
     );
     
     fireEvent.click(screen.getByTitle('Settings'));
     expect(mockOnSettingsClick).toHaveBeenCalled();
   });

   it('does not render theme selector in footer', () => {
     render(<Sidebar isOpen={true} onToggle={() => {}} />);
     expect(screen.queryByText('Theme')).not.toBeInTheDocument();
   });
   ```

2. **Update Sidebar component**:
   - Remove `currentTheme` and `onThemeChange` props
   - Add `onSettingsClick` prop
   - Remove ThemeSelector from footer (lines 102-104)
   - Connect settings button (line 56) to `onSettingsClick`

3. **Update Sidebar interface**:
   ```typescript
   interface SidebarProps {
     isOpen: boolean;
     onToggle: () => void;
     onSettingsClick?: () => void; // Add this
     children: React.ReactNode;
     // Remove: currentTheme: string;
     // Remove: onThemeChange: (theme: string) => void;
   }
   ```

**Regression Testing**:
- Verify sidebar still opens/closes correctly
- Verify settings button is clickable and visible
- Verify no theme selector visible in sidebar
- Check collapsed sidebar state works

**Commit**: "refactor: remove theme selector from sidebar, add settings button handler"

**✅ COMPLETED**: Sidebar successfully updated with TDD approach:
- Removed `currentTheme` and `onThemeChange` props from SidebarProps interface
- Added optional `onSettingsClick` prop for settings button handling
- Removed ThemeSelector component from footer (lines 102-104)
- Added settings button with onClick handler in both collapsed and expanded states
- Created comprehensive test suite with 9 tests covering settings button, theme removal, and regression testing
- All tests passing with no regressions - sidebar functionality preserved
- Removed unused ThemeSelector import for clean dependencies

### Task 4: Wire Up Complete Settings Flow

**Objective**: Connect all pieces and demonstrate working settings modal

**Files to Create**:
- `packages/web/components/settings/SettingsContainer.tsx` (state management)

**Files to Update**:
- Parent component that uses Sidebar (likely a page component)

**TDD Steps**:
1. **Write integration test**:
   ```typescript
   // packages/web/components/settings/SettingsContainer.test.tsx
   import { render, screen, fireEvent } from '@testing-library/react';
   import { SettingsContainer } from './SettingsContainer';

   describe('SettingsContainer', () => {
     it('opens settings modal when triggered', () => {
       const { getByTestId } = render(<SettingsContainer />);
       
       fireEvent.click(getByTestId('settings-trigger'));
       expect(screen.getByRole('dialog')).toBeInTheDocument();
       expect(screen.getByText('Settings')).toBeInTheDocument();
     });

     it('changes theme when selected in settings', () => {
       const { getByTestId } = render(<SettingsContainer />);
       
       fireEvent.click(getByTestId('settings-trigger'));
       fireEvent.click(screen.getByText('light'));
       
       // Verify theme applied to document
       expect(document.documentElement.getAttribute('data-theme')).toBe('light');
     });
   });
   ```

2. **Implement SettingsContainer**:
   ```typescript
   // packages/web/components/settings/SettingsContainer.tsx
   // ABOUTME: Container component managing settings modal state and theme persistence
   // ABOUTME: Provides integration point between settings UI and application state

   'use client';

   import React, { useState, useEffect } from 'react';
   import { SettingsModal } from './SettingsModal';
   import { SettingsTabs } from './SettingsTabs';
   import { UISettingsPanel } from './panels/UISettingsPanel';

   interface SettingsContainerProps {
     children: (props: { onOpenSettings: () => void }) => React.ReactNode;
   }

   export function SettingsContainer({ children }: SettingsContainerProps) {
     const [isOpen, setIsOpen] = useState(false);
     const [currentTheme, setCurrentTheme] = useState('dark');

     useEffect(() => {
       const savedTheme = localStorage.getItem('theme') || 'dark';
       setCurrentTheme(savedTheme);
       document.documentElement.setAttribute('data-theme', savedTheme);
     }, []);

     const handleThemeChange = (theme: string) => {
       setCurrentTheme(theme);
       localStorage.setItem('theme', theme);
       document.documentElement.setAttribute('data-theme', theme);
     };

     const handleOpenSettings = () => setIsOpen(true);
     const handleCloseSettings = () => setIsOpen(false);

     return (
       <>
         {children({ onOpenSettings: handleOpenSettings })}
         
         <SettingsModal isOpen={isOpen} onClose={handleCloseSettings}>
           <SettingsTabs defaultTab="ui">
             <UISettingsPanel 
               currentTheme={currentTheme}
               onThemeChange={handleThemeChange}
             />
           </SettingsTabs>
         </SettingsModal>
       </>
     );
   }
   ```

**Integration Testing**:
- Test complete flow: button click → modal open → theme change → persistence
- Test modal close functionality
- Test theme persistence across page reloads
- Test accessibility with screen readers

**Performance Testing**:
- Verify modal doesn't cause layout shifts
- Check theme change performance
- Ensure no memory leaks from event listeners

**Commit**: "feat: complete settings flow with theme selector integration"

### Task 5: Add User Settings Panel (Future Extension)

**Note**: This task shows the pattern for extending settings. Implement only if explicitly requested.

**Files to Create**:
- `packages/web/components/settings/panels/UserSettingsPanel.tsx`
- `packages/web/components/ui/TextAreaField.tsx`

**TDD Example**:
```typescript
// Future user settings test
it('saves user name to localStorage', () => {
  render(<UserSettingsPanel />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'John Doe' } });
  fireEvent.click(screen.getByText('Save'));
  
  expect(localStorage.getItem('userName')).toBe('John Doe');
});
```

## Testing Strategy

### Unit Tests
- **Component rendering** - All components render without crashing
- **Props handling** - Components accept and use props correctly
- **Event handling** - Click handlers and callbacks work
- **State management** - Local state updates correctly

### Integration Tests  
- **Theme persistence** - Theme selections saved to localStorage
- **Modal interactions** - Opening, closing, tab switching
- **Real component composition** - Settings panels work together

### E2E Tests (Optional)
- **Complete user journey** - Open settings → change theme → verify application
- **Accessibility** - Keyboard navigation, screen reader compatibility

### Test Commands
```bash
# Run all settings tests
npm test -- packages/web/components/settings/

# Run with coverage
npm run test:coverage -- packages/web/components/settings/

# Run integration tests
npm run test:integration

# Watch mode during development
npm test -- --watch packages/web/components/settings/
```

## File Structure After Implementation

```
packages/web/components/
├── settings/
│   ├── index.ts                          # Barrel exports
│   ├── SettingsModal.tsx                 # Main modal container
│   ├── SettingsModal.test.tsx
│   ├── SettingsTabs.tsx                  # Tab navigation
│   ├── SettingsTabs.test.tsx
│   ├── SettingsPanel.tsx                 # Base panel component
│   ├── SettingsPanel.test.tsx
│   ├── SettingField.tsx                  # Field wrapper component
│   ├── SettingField.test.tsx
│   ├── SettingsContainer.tsx             # State management container
│   ├── SettingsContainer.test.tsx
│   └── panels/
│       ├── UISettingsPanel.tsx           # Theme and UI settings
│       ├── UISettingsPanel.test.tsx
│       ├── UserSettingsPanel.tsx         # Future: user preferences
│       └── SystemSettingsPanel.tsx       # Future: system settings
├── ui/
│   ├── ThemeSelector.tsx                 # Existing, unchanged
│   └── ...
└── layout/
    ├── Sidebar.tsx                       # Updated to remove theme selector
    └── Sidebar.test.tsx                  # Updated tests
```

## Common Pitfalls & Solutions

### TypeScript Issues
- **Problem**: `any` type usage
- **Solution**: Use `unknown` and type guards
  ```typescript
  // Bad
  const data: any = JSON.parse(response);
  
  // Good
  const data: unknown = JSON.parse(response);
  if (typeof data === 'object' && data !== null && 'theme' in data) {
    // Now safely use data.theme
  }
  ```

### Testing Anti-Patterns
- **Problem**: Mocking components under test
- **Solution**: Use real components, mock external dependencies only
  ```typescript
  // Bad - mocking the component we're testing
  jest.mock('./ThemeSelector');
  
  // Good - testing real component
  import { ThemeSelector } from './ThemeSelector';
  render(<ThemeSelector currentTheme="dark" />);
  ```

### State Management Issues
- **Problem**: Props drilling or complex state
- **Solution**: Use container pattern for state management
- **Keep components pure** - Settings panels should be stateless

### Modal Accessibility
- **Must include**: `role="dialog"`, focus management, escape key handling
- **Test with**: Tab navigation, screen readers
- **Reference**: Existing SessionConfigPanel for patterns

## Definition of Done

### For Each Task
- [ ] TDD cycle completed (test → implement → refactor)
- [ ] TypeScript compilation passes with no errors
- [ ] All tests pass with >90% coverage
- [ ] Component renders in Storybook (if applicable)
- [ ] Accessibility attributes included
- [ ] Code reviewed and committed

### For Complete Feature
- [ ] Theme selector moved from sidebar to settings
- [ ] Settings modal opens/closes correctly
- [ ] Theme changes persist across sessions
- [ ] No regression in existing functionality
- [ ] Documentation updated (this file)
- [ ] Ready for future settings panel additions

## Commands Reference

```bash
# Development
npm run dev                    # Start development server
npm run storybook             # View components in Storybook

# Testing  
npm test                      # Run tests in watch mode
npm run test:run              # Run tests once
npm run test:coverage         # Coverage report
npm run test:integration      # Integration tests

# Building
npm run build                 # Build for production
npm run lint                  # Check linting
npm run lint:fix              # Fix linting issues
npm run format                # Format code

# Git workflow
git add .                     # Stage changes
git commit -m "feat: ..."     # Commit with conventional message
```

Remember: Follow TDD religiously, commit frequently, never use `any` types, and never mock the functionality under test.