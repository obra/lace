# Design System Import Plan

This document provides step-by-step instructions for importing the sophisticated design system from `f-web-spicy` into the monorepo structure at `f-integrate-spicy-web/packages/web/`.

**CRITICAL:** All commits importing content from f-web-spicy MUST use:
```bash
git commit --author "Jason Shellen <jason@shellen.com>" -m "commit message"
```

**IMPORTANT:** We are ONLY importing the design system components and infrastructure. We are NOT importing anything from the `app/` directory of f-web-spicy - our existing web application is more mature and should be preserved completely.

## Prerequisites

1. Ensure you're in the correct worktree: `f-integrate-spicy-web`
2. Current branch should be a feature branch for this work (e.g., `feature/import-design-system`)
3. Verify both source (`../f-web-spicy`) and target directories exist
4. Start from the root of the f-integrate-spicy-web worktree

## Phase 1: Preserve Existing Application

### Step 1: Move Existing Components to Safe Namespace

**Goal:** Move current components to `old/` namespace so they keep working while we import new design system

**Actions:**
1. Navigate to: `packages/web/components/`
2. Create new directory: `mkdir old`
3. Move ALL existing component files to the `old/` directory:
   ```bash
   mv *.tsx old/
   mv *.ts old/
   ```
4. Verify these 17 files are now in `packages/web/components/old/`:
   - AgentSpawner.tsx
   - ConversationDisplay.tsx
   - CreateProjectModal.tsx
   - CreateTaskModal.tsx
   - ErrorBoundary.tsx
   - LaceTerminal.tsx
   - ProjectManager.tsx
   - ProjectSettings.tsx
   - SessionManager.tsx
   - TaskDashboard.tsx
   - TaskDetailModal.tsx
   - TaskFilters.tsx
   - TaskList.tsx
   - TaskListItem.tsx
   - TaskNotes.tsx
   - TaskSummary.tsx
   - ToolApprovalModal.tsx

**Commit:**
```bash
git add packages/web/components/
git commit -m "refactor: move existing components to old/ namespace for design system migration

Preserves existing functionality while preparing for design system import.
All components moved to packages/web/components/old/ directory."
```

### Step 2: Update Component Imports

**Goal:** Update all imports to use the new `old/` namespace so the app continues working

**Files to update:**
- All files that import components from `../components/ComponentName`
- Search across the entire `packages/web/` directory

**Actions:**
1. Search for component imports:
   ```bash
   grep -r "from.*components/" packages/web/
   ```
2. Update each import to add `old/` to the path:
   - Find: `from '../components/TaskDashboard'`
   - Replace: `from '../components/old/TaskDashboard'`
   - Find: `from './components/ConversationDisplay'`
   - Replace: `from './components/old/ConversationDisplay'`

**Expected files to update:**
- Look in `packages/web/app/` directory for page files
- Check any files that import from the components directory

**Verification:**
1. Run: `cd packages/web && npm run build`
2. Should build successfully
3. Run: `cd packages/web && npm run dev`
4. Should start successfully and show the existing application

**Commit:**
```bash
git add packages/web/
git commit -m "fix: update component imports to use old/ namespace

Updates all imports to reference components in their new old/ location.
Ensures existing application continues working during design system migration."
```

## Phase 2: Core Infrastructure Setup

### Step 3: Update Package Dependencies

**Goal:** Add all design system dependencies to match f-web-spicy

**File to modify:** `packages/web/package.json`

**Actions:**
1. Open `packages/web/package.json`
2. Compare with `../f-web-spicy/package.json` and update these dependencies:

**Update existing dependencies to these versions:**
```json
"next": "15.3.5",
"react": "18.3.1",
"react-dom": "18.3.1",
"@tailwindcss/typography": "^0.5.15",
"tailwindcss": "4.1.11"
```

**Add these new dependencies (copy exact versions from ../f-web-spicy/package.json):**
```json
"daisyui": "5.0.46",
"@fortawesome/fontawesome-svg-core": "6.7.0",
"@fortawesome/free-solid-svg-icons": "6.7.0",
"@fortawesome/react-fontawesome": "0.2.2",
"@heroicons/react": "2.2.0",
"framer-motion": "12.23.3",
"clsx": "^2.1.1",
"class-variance-authority": "^0.7.1"
```

**Add these dev dependencies:**
```json
"@storybook/react": "9.0.17",
"@storybook/addon-essentials": "9.0.17",
"@storybook/addon-interactions": "9.0.17",
"@storybook/addon-links": "9.0.17",
"@storybook/addon-a11y": "9.0.17",
"@storybook/addon-docs": "9.0.17",
"@storybook/nextjs": "9.0.17",
"@storybook/test": "9.0.17",
"chromatic": "^6.0.0"
```

**Add these scripts:**
```json
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build",
"chromatic": "chromatic --exit-zero-on-changes"
```

**Commit:**
```bash
git add packages/web/package.json
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: add design system dependencies and Storybook tooling

Adds DaisyUI, FontAwesome, Framer Motion, and Storybook infrastructure
to support the comprehensive design system being imported."
```

### Step 4: Install New Dependencies

**Goal:** Install all the new dependencies

**Actions:**
1. Navigate to: `cd packages/web`
2. Install dependencies: `npm install`
3. Verify no errors during installation

**Note:** If there are dependency conflicts, note them and we'll resolve them in later steps.

**Commit (only if changes were made to package-lock.json):**
```bash
git add package-lock.json
git commit -m "chore: install new design system dependencies

Updates package-lock.json with design system dependencies."
```

### Step 5: Import Tailwind Configuration

**Goal:** Replace basic Tailwind config with advanced design system configuration

**Files to copy:**
- Source: `../f-web-spicy/tailwind.config.js`
- Target: `packages/web/tailwind.config.js` (replace existing)

**Actions:**
1. Backup existing config: `cp packages/web/tailwind.config.js packages/web/tailwind.config.js.backup`
2. Copy new config: `cp ../f-web-spicy/tailwind.config.js packages/web/tailwind.config.js`
3. Open `packages/web/tailwind.config.js` and update the content paths:
   ```javascript
   content: [
     "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
     "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
     "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
     "./.storybook/**/*.{js,ts,jsx,tsx,mdx}"
   ],
   ```

**Commit:**
```bash
git add packages/web/tailwind.config.js
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import advanced Tailwind config with DaisyUI themes

Replaces basic Tailwind configuration with comprehensive design system
config including DaisyUI themes, custom colors, and advanced features."
```

### Step 6: Import PostCSS Configuration

**Goal:** Add modern PostCSS pipeline

**Files to copy:**
- Source: `../f-web-spicy/postcss.config.js`
- Target: `packages/web/postcss.config.js` (replace if exists)

**Actions:**
1. Copy file: `cp ../f-web-spicy/postcss.config.js packages/web/postcss.config.js`

**Commit:**
```bash
git add packages/web/postcss.config.js
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import PostCSS configuration for design system

Adds modern PostCSS pipeline configuration to support
Tailwind CSS and DaisyUI processing."
```

### Step 7: Update Next.js Configuration

**Goal:** Import advanced Next.js config features

**Files to copy:**
- Source: `../f-web-spicy/next.config.js`
- Target: `packages/web/next.config.js` (replace existing)

**Actions:**
1. Backup existing: `cp packages/web/next.config.js packages/web/next.config.js.backup`
2. Copy new config: `cp ../f-web-spicy/next.config.js packages/web/next.config.js`
3. Review the new config - no modifications should be needed for monorepo

**Commit:**
```bash
git add packages/web/next.config.js
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import advanced Next.js configuration

Adds Turbopack optimizations, webpack fallbacks, and advanced
Next.js configuration features for improved development experience."
```

### Step 8: Update Global Styles

**Goal:** Import design system CSS foundation while preserving custom styles

**Files to copy:**
- Source: `../f-web-spicy/src/app/globals.css`
- Target: `packages/web/src/app/globals.css` (carefully merge)

**Actions:**
1. **IMPORTANT:** Backup existing styles: `cp packages/web/src/app/globals.css packages/web/src/app/globals.css.backup`
2. Review the backup file for any custom terminal colors or styles that should be preserved
3. Copy new styles: `cp ../f-web-spicy/src/app/globals.css packages/web/src/app/globals.css`
4. If the backup contained custom styles (like terminal colors), add them to the end of the new globals.css file:
   ```css
   /* Custom terminal theme colors - preserved from old implementation */
   /* Add any custom styles from the backup file here */
   ```

**Commit:**
```bash
git add packages/web/src/app/globals.css
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import design system global styles

Imports comprehensive CSS foundation including DaisyUI base styles,
custom utility classes, and modern CSS reset. Preserves any existing
custom styles for terminal theme compatibility."
```

## Phase 3: Storybook Infrastructure

### Step 9: Import Complete Storybook Configuration

**Goal:** Set up Storybook 9 with all advanced features

**Directory to copy:**
- Source: `../f-web-spicy/.storybook/`
- Target: `packages/web/.storybook/` (create new)

**Actions:**
1. Create directory: `mkdir packages/web/.storybook`
2. Copy all files: `cp -r ../f-web-spicy/.storybook/* packages/web/.storybook/`
3. Verify these files were copied:
   - main.ts
   - preview.ts  
   - manager.ts
   - preview-head.html
4. Update `packages/web/.storybook/main.ts` to fix the stories path:
   ```typescript
   stories: [
     "../src/**/*.stories.@(js|jsx|ts|tsx|mdx)"
   ],
   ```

**Commit:**
```bash
git add packages/web/.storybook/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import complete Storybook 9 configuration

Adds comprehensive Storybook setup with Next.js integration,
accessibility addon, docs addon, and advanced development features."
```

### Step 10: Import Storybook Utilities

**Goal:** Import Storybook helper utilities and decorators

**Files to copy:**
- Source: `../f-web-spicy/src/lib/storybook-utils.ts`
- Target: `packages/web/src/lib/storybook-utils.ts`

**Actions:**
1. Create directory if needed: `mkdir -p packages/web/src/lib`
2. Copy file: `cp ../f-web-spicy/src/lib/storybook-utils.ts packages/web/src/lib/storybook-utils.ts`
3. Check if there are other storybook-related files in `../f-web-spicy/src/lib/` and copy them too

**Commit:**
```bash
git add packages/web/src/lib/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import Storybook utilities and helper functions

Adds utility functions for Storybook stories, decorators,
and component documentation helpers."
```

## Phase 4: Core Design System Components

### Step 11: Import UI Components (Atoms & Molecules)

**Goal:** Import all atomic design system components

**Directory to copy:**
- Source: `../f-web-spicy/src/components/ui/`
- Target: `packages/web/components/ui/`

**Actions:**
1. Create directory: `mkdir -p packages/web/components/ui`
2. Copy all files: `cp -r ../f-web-spicy/src/components/ui/* packages/web/components/ui/`
3. Verify all component and story files are present (should be 35+ components):
   - Button.tsx + Button.stories.tsx
   - Card.tsx + Card.stories.tsx
   - Input.tsx + Input.stories.tsx
   - Modal.tsx + Modal.stories.tsx
   - And many more...

**Expected files (verify these exist):**
```
packages/web/components/ui/
├── Avatar.tsx + Avatar.stories.tsx
├── Badge.tsx + Badge.stories.tsx
├── Button.tsx + Button.stories.tsx
├── Card.tsx + Card.stories.tsx
├── Dropdown.tsx + Dropdown.stories.tsx
├── Input.tsx + Input.stories.tsx
├── Modal.tsx + Modal.stories.tsx
├── Progress.tsx + Progress.stories.tsx
├── Skeleton.tsx + Skeleton.stories.tsx
├── Tabs.tsx + Tabs.stories.tsx
├── Toggle.tsx + Toggle.stories.tsx
├── Tooltip.tsx + Tooltip.stories.tsx
└── ... (and approximately 25+ more components)
```

**Commit:**
```bash
git add packages/web/components/ui/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import complete UI component library (atoms and molecules)

Imports 35+ atomic design system components with comprehensive
Storybook documentation including buttons, cards, inputs, modals,
and all foundational UI primitives."
```

### Step 12: Import Page Templates

**Goal:** Import page-level component templates

**Directory to copy:**
- Source: `../f-web-spicy/src/components/pages/`
- Target: `packages/web/components/pages/`

**Actions:**
1. Create directory: `mkdir -p packages/web/components/pages`
2. Copy all files: `cp -r ../f-web-spicy/src/components/pages/* packages/web/components/pages/`
3. Verify page components and their stories are present

**Commit:**
```bash
git add packages/web/components/pages/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import page template components

Adds comprehensive page-level component templates and layouts
that demonstrate proper composition of atomic design system elements."
```

### Step 13: Import Specialized Component Collections

**Goal:** Import domain-specific component groups

**Directories to copy (do each separately):**

**Timeline Components:**
1. Create: `mkdir -p packages/web/components/timeline`
2. Copy: `cp -r ../f-web-spicy/src/components/timeline/* packages/web/components/timeline/`

**File Components:**
1. Create: `mkdir -p packages/web/components/files`
2. Copy: `cp -r ../f-web-spicy/src/components/files/* packages/web/components/files/`

**Layout Components:**
1. Create: `mkdir -p packages/web/components/layout`
2. Copy: `cp -r ../f-web-spicy/src/components/layout/* packages/web/components/layout/`

**Modal Components:**
1. Create: `mkdir -p packages/web/components/modals`
2. Copy: `cp -r ../f-web-spicy/src/components/modals/* packages/web/components/modals/`

**Feedback Components:**
1. Create: `mkdir -p packages/web/components/feedback`
2. Copy: `cp -r ../f-web-spicy/src/components/feedback/* packages/web/components/feedback/`

**Chat Components:**
1. Create: `mkdir -p packages/web/components/chat`
2. Copy: `cp -r ../f-web-spicy/src/components/chat/* packages/web/components/chat/`

**Organism Components:**
1. Create: `mkdir -p packages/web/components/organisms`
2. Copy: `cp -r ../f-web-spicy/src/components/organisms/* packages/web/components/organisms/`

**Commit:**
```bash
git add packages/web/components/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import specialized component collections

Adds domain-specific component libraries including timeline, files,
layout, modals, feedback, chat, and organism components with
comprehensive Storybook documentation."
```

### Step 14: Import Demo Components

**Goal:** Import demonstration and example components

**Directory to copy:**
- Source: `../f-web-spicy/src/components/demo/`
- Target: `packages/web/components/demo/`

**Actions:**
1. Create directory: `mkdir -p packages/web/components/demo`
2. Copy all files: `cp -r ../f-web-spicy/src/components/demo/* packages/web/components/demo/`

**Commit:**
```bash
git add packages/web/components/demo/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import demo and example components

Adds demonstration components that showcase design system usage
and provide interactive examples for development reference."
```

## Phase 5: Supporting Infrastructure

### Step 15: Import Component Registry

**Goal:** Import component tracking and registry system

**Files to copy:**
- Source: `../f-web-spicy/src/lib/component-registry.ts`
- Target: `packages/web/src/lib/component-registry.ts`

**Actions:**
1. Copy file: `cp ../f-web-spicy/src/lib/component-registry.ts packages/web/src/lib/component-registry.ts`

**Commit:**
```bash
git add packages/web/src/lib/component-registry.ts
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import component registry and tracking system

Adds automated component registry for tracking design system
completion and providing development insights."
```

### Step 16: Import Utility Functions

**Goal:** Import design system utility functions

**Files to check and copy from `../f-web-spicy/src/lib/`:**
- `utils.ts` (if exists)
- `cn.ts` (if exists) 
- Any other utility files that support the design system

**Actions:**
1. List files: `ls ../f-web-spicy/src/lib/`
2. Copy relevant utility files (exclude API-related utilities)
3. Common files to look for:
   - `cp ../f-web-spicy/src/lib/utils.ts packages/web/src/lib/utils.ts` (if exists)
   - `cp ../f-web-spicy/src/lib/cn.ts packages/web/src/lib/cn.ts` (if exists)

**Commit:**
```bash
git add packages/web/src/lib/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import design system utility functions

Adds utility functions for class name merging, component variants,
and other design system support functions."
```

### Step 17: Import Type Definitions

**Goal:** Import design system type definitions

**Files to check in `../f-web-spicy/src/types/`:**
- Look for component-related types
- Skip API-related types (we keep our own)

**Actions:**
1. List files: `ls ../f-web-spicy/src/types/`
2. Copy design system related types:
   - Look for files like `component.ts`, `ui.ts`, `theme.ts`
   - Skip files like `api.ts`, `session.ts` (we have our own)
3. Create directory if needed: `mkdir -p packages/web/src/types`
4. Copy relevant files

**Commit:**
```bash
git add packages/web/src/types/
git commit --author "Jason Shellen <jason@shellen.com>" -m "feat: import design system type definitions

Adds TypeScript type definitions for design system components,
themes, and variant configurations."
```

## Phase 6: Documentation

### Step 18: Import Design System Documentation

**Goal:** Import design system documentation and guides

**Directory to copy:**
- Source: `../f-web-spicy/docs/visualdesign/`
- Target: `packages/web/docs/design-system/`

**Actions:**
1. Create directory: `mkdir -p packages/web/docs/design-system`
2. Copy documentation files:
   ```bash
   cp ../f-web-spicy/docs/visualdesign/STORYBOOK_MIGRATION_PLAN.md packages/web/docs/design-system/
   cp ../f-web-spicy/docs/visualdesign/FEATURES_DEMO.md packages/web/docs/design-system/
   cp ../f-web-spicy/docs/visualdesign/VISUAL_REGRESSION_TESTING.md packages/web/docs/design-system/
   ```
3. Skip any files that appear to be work-in-progress or outdated

**Commit:**
```bash
git add packages/web/docs/design-system/
git commit --author "Jason Shellen <jason@shellen.com>" -m "docs: import design system documentation

Adds comprehensive documentation for design system usage,
Storybook integration, and visual regression testing."
```

## Phase 7: Testing and Setup

### Step 19: Create Component Index Files

**Goal:** Set up clean import paths for new components

**Files to create:**

**packages/web/components/ui/index.ts:**
```typescript
// Export all UI components for clean imports
export { Button } from './Button';
export { Card } from './Card';
export { Input } from './Input';
export { Modal } from './Modal';
export { Badge } from './Badge';
export { Avatar } from './Avatar';
export { Progress } from './Progress';
export { Skeleton } from './Skeleton';
export { Tooltip } from './Tooltip';
export { Alert } from './Alert';
export { Tabs } from './Tabs';
export { Dropdown } from './Dropdown';
export { Toggle } from './Toggle';
export { Slider } from './Slider';
export { Spinner } from './Spinner';
// Add exports for all other UI components found in the directory
```

**packages/web/components/index.ts:**
```typescript
// Re-export everything for convenience
export * from './ui';
export * from './pages';
export * from './timeline';
export * from './files';
export * from './layout';
export * from './modals';
export * from './feedback';
export * from './chat';
export * from './organisms';
export * from './demo';
```

**Actions:**
1. Create the ui/index.ts file with exports for all components found in the ui directory
2. Create the main index.ts file 
3. List all components to ensure exports are complete:
   ```bash
   ls packages/web/components/ui/*.tsx | grep -v stories
   ```

**Commit:**
```bash
git add packages/web/components/index.ts packages/web/components/ui/index.ts
git commit -m "feat: create component index files for clean imports

Enables clean import syntax like 'import { Button } from @/components/ui'
and provides convenient re-exports for all design system components."
```

### Step 20: Configure TypeScript Path Aliases

**Goal:** Set up path aliases for clean imports

**File to modify:** `packages/web/tsconfig.json`

**Actions:**
1. Open `packages/web/tsconfig.json`
2. Add or update the `paths` section in `compilerOptions`:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "~/*": ["./src/*"],
         "@/components/*": ["./src/components/*"],
         "@/ui/*": ["./src/components/ui/*"],
         "@/lib/*": ["./src/lib/*"],
         "@/types/*": ["./src/types/*"]
       }
     }
   }
   ```

**Commit:**
```bash
git add packages/web/tsconfig.json
git commit -m "feat: configure TypeScript path aliases for clean imports

Enables clean import paths like @/components/ui and ~/lib/utils
for improved developer experience and consistent import patterns."
```

### Step 21: Test Build and Storybook

**Goal:** Verify everything builds and runs correctly

**Actions:**
1. Navigate to: `cd packages/web`
2. Build the project: `npm run build`
3. If build succeeds, start Storybook: `npm run storybook`
4. If Storybook starts successfully, open browser to `http://localhost:6006`
5. Verify all imported components appear in Storybook
6. Test existing app: `npm run dev`
7. Verify existing app loads at `http://localhost:3000`

**If there are build errors:**
- Check import paths in components
- Ensure all dependencies are installed
- Look for TypeScript compilation errors
- Update any broken relative imports to use new path aliases

**Commit (only if fixes were needed):**
```bash
git add packages/web/src/
git commit -m "fix: resolve build issues and import path conflicts

Fixes any TypeScript compilation errors and import path issues
discovered during initial build testing."
```

### Step 22: Test Existing Application

**Goal:** Ensure existing app functionality is preserved

**Actions:**
1. Start the development server: `cd packages/web && npm run dev`
2. Open browser to `http://localhost:3000`
3. Test all existing functionality:
   - Can create and view tasks
   - Can start conversations
   - All existing pages load correctly
   - No console errors in browser
4. Verify all existing components in `old/` directory are working

**If there are issues:**
- Check that all imports were updated correctly in Step 2
- Verify no components were missed in the move to `old/`
- Check browser console for any missing imports

**Commit (only if fixes were needed):**
```bash
git add packages/web/src/
git commit -m "fix: resolve issues with existing application functionality

Ensures all existing features continue working after design system import
and component reorganization."
```

## Phase 8: Final Setup and Documentation

### Step 23: Create Usage Documentation

**Goal:** Document how to use the imported design system

**File to create:** `packages/web/docs/DESIGN_SYSTEM_USAGE.md`

**Content:**
```markdown
# Design System Usage Guide

## Overview
This document explains how to use the imported design system components in the Lace web application.

## Available Components
The design system includes 35+ UI components organized into:
- **UI Components** (`src/components/ui/`): Atoms and molecules (Button, Card, Input, Modal, etc.)
- **Page Templates** (`src/components/pages/`): Full page layouts
- **Specialized Collections**: Timeline, files, layout, modals, feedback, chat, organisms
- **Demo Components** (`src/components/demo/`): Examples and demonstrations

## Using Components

### Clean Imports
```typescript
// Import individual components
import { Button, Card, Input } from '@/components/ui';

// Or import everything
import * from '@/components';
```

### Example Usage
```typescript
import { Button } from '@/components/ui';

export function MyComponent() {
  return (
    <Button variant="primary" size="md">
      Click me
    </Button>
  );
}
```

## Storybook
View all available components and their documentation:
```bash
npm run storybook
```

## Migration Strategy
- Existing components are in `src/components/old/`
- New features should use design system components
- Gradually replace old components with new ones built using the design system
- Remove components from `old/` directory when no longer used

## Resources
- Storybook: http://localhost:6006 (when running)
- Design System Docs: `docs/design-system/`
- Component Registry: `src/lib/component-registry.ts`
```

**Actions:**
1. Create the file with the content above
2. Update any specific details based on what was actually imported

**Commit:**
```bash
git add packages/web/docs/DESIGN_SYSTEM_USAGE.md
git commit -m "docs: create design system usage guide for developers

Provides comprehensive guide for using imported design system components,
migration strategy, and development resources."
```

### Step 24: Update Root Package Scripts

**Goal:** Add convenient scripts at monorepo root level

**File to modify:** `package.json` (in root of f-integrate-spicy-web)

**Actions:**
1. Open root `package.json`
2. Add these scripts to the `scripts` section:
   ```json
   "web:dev": "npm run dev --workspace=packages/web",
   "web:build": "npm run build --workspace=packages/web",
   "web:storybook": "npm run storybook --workspace=packages/web",
   "web:test": "npm run test --workspace=packages/web"
   ```

**Commit:**
```bash
git add package.json
git commit -m "feat: add web package convenience scripts to root

Enables running web development commands from monorepo root
with npm run web:dev, web:storybook, etc."
```

## Completion Verification

After completing all steps, verify:

### Build and Development
- [ ] `cd packages/web && npm install` completes without errors
- [ ] `cd packages/web && npm run build` succeeds
- [ ] `cd packages/web && npm run dev` starts the app successfully
- [ ] Existing application loads at http://localhost:3000 and works normally
- [ ] All existing functionality (tasks, conversations, etc.) works

### Storybook
- [ ] `cd packages/web && npm run storybook` starts successfully
- [ ] Storybook opens at http://localhost:6006
- [ ] All imported components are visible in Storybook
- [ ] Component stories load and render correctly

### Code Quality
- [ ] No TypeScript compilation errors
- [ ] No console errors in browser
- [ ] All imports resolve correctly
- [ ] Existing components in `old/` directory work normally

### File Structure
- [ ] All existing components moved to `packages/web/components/old/`
- [ ] Design system components imported to `packages/web/components/ui/`
- [ ] Specialized components imported to appropriate directories
- [ ] Documentation imported to `packages/web/docs/design-system/`
- [ ] Storybook configuration in `packages/web/.storybook/`

## Next Steps

After successful completion:

1. **Start Using Design System**: New features should use components from `@/components/ui`
2. **Plan Component Migration**: Identify which components in `old/` to replace first
3. **Team Training**: Share the usage documentation with the development team
4. **Visual Testing**: Set up Chromatic for visual regression testing
5. **Gradual Migration**: Replace old components one at a time with new design system implementations

## Troubleshooting

### Common Issues

**Dependency Conflicts:**
- Delete `node_modules` and `package-lock.json`, then run `npm install`
- Check for version mismatches in `package.json`

**Import Path Errors:**
- Verify TypeScript path aliases are configured correctly
- Check that all relative imports have been updated
- Ensure index files export all components

**Storybook Issues:**
- Verify `.storybook/main.ts` has correct stories path
- Check that all story files are properly formatted
- Ensure all component dependencies are available

**Build Failures:**
- Check TypeScript compilation errors carefully
- Verify all imported files exist
- Look for missing dependencies

If you encounter issues, check:
1. Console output for specific error messages
2. That all files were copied to correct locations
3. That git commits used the correct author attribution
4. That existing application still works before and after each step