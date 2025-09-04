# Design System Usage Guide

## Overview

This document explains how to use the imported design system components in the
Lace web application.

## Available Components

The design system includes 72+ UI components organized into:

- **UI Components** (`src/components/ui/`): Atoms and molecules (Button, Card,
  Input, Modal, etc.)
- **Page Templates** (`src/components/pages/`): Full page layouts
- **Specialized Collections**: Timeline, files, layout, modals, feedback, chat,
  organisms
- **Demo Components** (`src/components/demo/`): Examples and demonstrations

## Using Components

### Clean Imports

```typescript
// Import individual components
import { Avatar, Badge, CodeBlock } from '@/components/ui';

// Or import everything
import * from '@/components';
```

### Example Usage

```typescript
import { Badge, Avatar } from '@/components/ui';

export function UserDisplay({ user }) {
  return (
    <div className="flex items-center space-x-2">
      <Avatar src={user.avatar} alt={user.name} />
      <Badge variant="secondary">{user.role}</Badge>
    </div>
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

## Component Collections

### UI Components (39 components)

Atomic design system components including:

- `AccountDropdown`, `AgentBadge`, `Avatar`, `Badge`
- `AnimatedButton`, `AnimatedModal`, `AnimatedSidebar`
- `Carousel`, `ChatInputComposer`, `ChatTextarea`
- `CodeBlock`, `InlineCode`, `FileAttachment`
- `LoadingDots`, `Modal`, `Skeleton`, `StreamingIndicator`
- And many more...

### Specialized Collections

- **Timeline**: `TimelineView`, `TimelineMessage`, `AnimatedTimelineView`
- **Layout**: `Sidebar`, `MobileSidebar`, `PageHeader`
- **Feedback**: `FeedbackDisplay`, `FeedbackEventCard`, `PerformancePanel`
- **Chat**: Google Docs integration, message handling
- **Files**: File viewers, drag-drop overlays
- **Modals**: Task management, specialized dialogs

## Design System Features

### Theming

Built on DaisyUI with comprehensive theme support:

- Multiple pre-built themes
- Dark/light mode switching
- Consistent color palette
- Typography scales

### Animation System

Framer Motion integration for smooth animations:

- Page transitions
- Component state changes
- Hover effects
- Loading states

### Icon Systems

Dual icon library support:

- FontAwesome for general icons
- Heroicons for UI elements

### Accessibility

Components built with accessibility in mind:

- Proper ARIA labels
- Keyboard navigation
- Screen reader support
- Color contrast compliance

## Testing

### Visual Regression Testing

Chromatic integration for visual testing:

```bash
npm run chromatic
```

### Performance Testing

Lighthouse CI for performance monitoring:

```bash
npm run build
# Lighthouse tests run automatically in CI
```

## Resources

- **Storybook**: http://localhost:6006 (when running)
- **Design System Docs**: `docs/design-system/`
- **Component Registry**: `src/lib/component-registry.ts`
- **Animation Docs**: `ANIMATIONS.md`

## Troubleshooting

### Import Issues

If you encounter import errors:

1. Check that the component exists in the index files
2. Verify path aliases are configured in `tsconfig.json`
3. Ensure you're using `@/` for local imports and `~/` for monorepo root

### Build Errors

Some Storybook stories may have type mismatches that don't affect runtime:

- Storybook runs successfully despite these warnings
- The actual components work correctly
- Type fixes can be applied as needed

### Theme Issues

If themes don't apply correctly:

1. Check that DaisyUI is properly configured in `tailwind.config.js`
2. Verify global styles are imported in `globals.css`
3. Ensure theme provider is set up in your app
