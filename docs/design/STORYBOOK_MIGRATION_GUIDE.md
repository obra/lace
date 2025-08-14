# 🚀 Storybook Migration Execution Guide

This guide provides step-by-step instructions to execute the migration from Storybook to Ladle + Playground workflow.

## ✅ Pre-Migration Setup (Completed)

- [x] **Ladle installed** (`@ladle/react` v5.0.3)
- [x] **Ladle config created** (`packages/web/ladle.config.mjs`)
- [x] **NPM scripts added** (`npm run ladle`, `npm run ladle:build`)
- [x] **Playground page created** (`/app/play/page.tsx`)
- [x] **Stories parked directory** (`packages/web/stories_parked/`)
- [x] **Template migration completed** (AgentBadge example)

## 🎯 Next Steps to Complete Migration

### 1. Verify Ladle Setup
```bash
cd packages/web
npm run ladle
```
Should open Ladle dev server at http://localhost:61000 with KEEP stories.

### 2. Execute CONVERT Migrations (52 stories)

Use the AgentBadge template as reference for each CONVERT story:

#### For each CONVERT story:
1. **Create MDX file** next to component:
   ```bash
   # Example for TokenUsageDisplay
   touch components/ui/TokenUsageDisplay.mdx
   ```

2. **Add component to playground** (`/app/play/page.tsx`):
   ```tsx
   import TokenUsageDisplay from '@/components/ui/TokenUsageDisplay';
   
   // Add section with usage examples
   ```

3. **Create test file** (`components/ui/__tests__/ComponentName.test.tsx`):
   ```tsx
   import React from 'react';
   import { render, screen } from '@testing-library/react';
   import { describe, it, expect } from 'vitest';
   import ComponentName from '../ComponentName';
   
   describe('ComponentName', () => {
     it('renders correctly', () => {
       // Test basic functionality
     });
   });
   ```

4. **Remove original story file**:
   ```bash
   rm components/ui/TokenUsageDisplay.stories.tsx
   ```

### 3. Execute PARK Migrations (12 stories)

Move complex stories to parked directory:
```bash
# Example
mv packages/web/components/timeline/AnimatedTimelineView.stories.tsx packages/web/stories_parked/
```

Add header comment to parked files:
```ts
/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
```

## 📋 Migration Checklist

### KEEP Stories (11) - Ladle Migration
- [ ] `Badge.stories.tsx` → Verify works in Ladle
- [ ] `Modal.stories.tsx` → Verify works in Ladle
- [ ] `CodeBlock.stories.tsx` → Verify works in Ladle
- [ ] `Avatar.stories.tsx` → Verify works in Ladle
- [ ] `StatusDot.stories.tsx` → Verify works in Ladle
- [ ] `LoadingDots.stories.tsx` → Verify works in Ladle
- [ ] `SkeletonLoader.stories.tsx` → Verify works in Ladle
- [ ] `LoadingSkeleton.stories.tsx` → Verify works in Ladle
- [ ] `IconButton.stories.tsx` → Verify works in Ladle
- [ ] `InlineCode.stories.tsx` → Verify works in Ladle
- [ ] `Carousel.stories.tsx` → Verify works in Ladle

### CONVERT Stories (52) - MDX + Playground + Tests
- [x] `AgentBadge.stories.tsx` → **TEMPLATE COMPLETED** ✅
- [ ] `TokenUsageDisplay.stories.tsx` → MDX + Playground + Test
- [ ] `DirectoryField.stories.tsx` → MDX + Playground + Test
- [ ] `FileAttachment.stories.tsx` → MDX + Playground + Test
- [ ] `AnimatedButton.stories.tsx` → MDX + Playground + Test
- [ ] `VoiceButton.stories.tsx` → MDX + Playground + Test
- [ ] `AnimatedCarousel.stories.tsx` → MDX + Playground + Test
- [ ] `MessageDisplay.stories.tsx` → MDX + Playground + Test
- [ ] `VoiceRecognitionUI.stories.tsx` → MDX + Playground + Test
- [ ] `TimestampDisplay.stories.tsx` → MDX + Playground + Test
- [ ] `SectionHeader.stories.tsx` → MDX + Playground + Test
- [ ] `AccountDropdown.stories.tsx` → MDX + Playground + Test
- [ ] `SendButton.stories.tsx` → MDX + Playground + Test
- [ ] `SidebarSection.stories.tsx` → MDX + Playground + Test
- [ ] `DragDropOverlay.stories.tsx` → MDX + Playground + Test
- [ ] `SwipeableCard.stories.tsx` → MDX + Playground + Test
- [ ] `NavigationItem.stories.tsx` → MDX + Playground + Test
- [ ] `AnimatedModal.stories.tsx` → MDX + Playground + Test
- [ ] `FileAttachButton.stories.tsx` → MDX + Playground + Test
- [ ] `GlassCard.stories.tsx` → MDX + Playground + Test
- [ ] `ChatTextarea.stories.tsx` → MDX + Playground + Test
- [ ] `NavigationButton.stories.tsx` → MDX + Playground + Test
- [ ] `ChatInputComposer.stories.tsx` → MDX + Playground + Test
- [ ] `AdvancedSettingsCollapse.stories.tsx` → MDX + Playground + Test
- [ ] `ThemeSelector.stories.tsx` → MDX + Playground + Test
- [ ] `ExpandableHeader.stories.tsx` → MDX + Playground + Test
- [ ] `InfoSection.stories.tsx` → MDX + Playground + Test
- [ ] `VaporBackground.stories.tsx` → MDX + Playground + Test
- [ ] `MessageText.stories.tsx` → MDX + Playground + Test
- [ ] `InfoIconButton.stories.tsx` → MDX + Playground + Test
- [ ] `MessageHeader.stories.tsx` → MDX + Playground + Test
- [ ] `OnboardingHero.stories.tsx` → MDX + Playground + Test
- [ ] `StreamingIndicator.stories.tsx` → MDX + Playground + Test
- [ ] `AccentSelect.stories.tsx` → MDX + Playground + Test
- [ ] `MessageBubble.stories.tsx` → MDX + Playground + Test
- [ ] `AccentInput.stories.tsx` → MDX + Playground + Test
- [ ] `OnboardingActions.stories.tsx` → MDX + Playground + Test
- [ ] Plus 17 feature component stories...

### PARK Stories (12) - Archive
- [ ] `AnimatedTimelineView.stories.tsx` → Move to stories_parked/
- [ ] `AnimatedTypingIndicator.stories.tsx` → Move to stories_parked/
- [ ] `UnknownEventEntry.stories.tsx` → Move to stories_parked/
- [ ] `AnimatedTimelineMessage.stories.tsx` → Move to stories_parked/
- [ ] `TimelineView.stories.tsx` → Move to stories_parked/
- [ ] `TimelineMessage.stories.tsx` → Move to stories_parked/
- [ ] `TypingIndicator.stories.tsx` → Move to stories_parked/
- [ ] `IntegrationEntry.stories.tsx` → Move to stories_parked/
- [ ] `ChatInterface.stories.tsx` → Move to stories_parked/
- [ ] `LaceApp.stories.tsx` → Move to stories_parked/
- [ ] `AnimatedLaceApp.stories.tsx` → Move to stories_parked/
- [ ] `OnboardingWizard.stories.tsx` → Move to stories_parked/

## 🧪 Testing Your Migration

### Test Ladle
```bash
cd packages/web
npm run ladle
# Should show 11 KEEP stories
```

### Test Playground
```bash
npm run dev
# Visit /play to see component examples
```

### Test Components
```bash
npm test
# All migrated component tests should pass
```

## 🎉 Post-Migration Cleanup

1. **Update CI/CD**: Remove Storybook build, add optional Ladle build
2. **Update Documentation**: Update README with new workflow
3. **Team Communication**: Share new development workflow
4. **Remove Storybook Dependencies**: After migration is stable

## 💡 Development Workflow After Migration

### For KEEP Components (Primitives)
```bash
npm run ladle  # Fast Ladle server for core components
```

### For CONVERT Components (Feature Components)  
```bash
npm run dev    # Next.js with /play page for rapid testing
```

### For New Components
- **Primitives**: Create .stories.tsx file → shows in Ladle
- **Feature Components**: Add to /play page + create .mdx docs + tests

## 📊 Expected Performance Improvements

- **Startup time**: ~30 seconds → ~3 seconds (Ladle vs Storybook)
- **Hot reload**: Faster component iteration
- **Build time**: Reduced CI overhead
- **Developer experience**: Simpler tooling stack

---

**Migration Status**: Setup complete, ready for execution
**Template**: AgentBadge completed as reference pattern  
**Next Action**: Choose your first CONVERT story to migrate!