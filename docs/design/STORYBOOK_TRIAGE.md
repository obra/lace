# 📋 Storybook Migration Triage

Total stories found: **73 stories**

## Migration Classification

### 🟢 KEEP (11 stories) - Migrate to Ladle
*Highly reusable primitives that benefit from interactive story development*

- `packages/web/components/ui/Badge.stories.tsx` - Core primitive
- `packages/web/components/ui/Modal.stories.tsx` - Core primitive  
- `packages/web/components/ui/CodeBlock.stories.tsx` - Core primitive
- `packages/web/components/ui/Avatar.stories.tsx` - Core primitive
- `packages/web/components/ui/StatusDot.stories.tsx` - Core primitive
- `packages/web/components/ui/LoadingDots.stories.tsx` - Core primitive
- `packages/web/components/ui/SkeletonLoader.stories.tsx` - Core primitive
- `packages/web/components/ui/LoadingSkeleton.stories.tsx` - Core primitive
- `packages/web/components/ui/IconButton.stories.tsx` - Core primitive
- `packages/web/components/ui/InlineCode.stories.tsx` - Core primitive
- `packages/web/components/ui/Carousel.stories.tsx` - Core primitive

### 🟡 CONVERT (52 stories) - MDX + /play + tests
*Mid-use components that benefit from usage examples but don't need full story coverage*

#### UI Components (35)
- `packages/web/components/ui/TokenUsageDisplay.stories.tsx`
- `packages/web/components/ui/DirectoryField.stories.tsx`
- `packages/web/components/ui/FileAttachment.stories.tsx`
- `packages/web/components/ui/AnimatedButton.stories.tsx`
- `packages/web/components/ui/VoiceButton.stories.tsx`
- `packages/web/components/ui/AnimatedCarousel.stories.tsx`
- `packages/web/components/ui/MessageDisplay.stories.tsx`
- `packages/web/components/ui/VoiceRecognitionUI.stories.tsx`
- `packages/web/components/ui/TimestampDisplay.stories.tsx`
- `packages/web/components/ui/SectionHeader.stories.tsx`
- `packages/web/components/ui/AccountDropdown.stories.tsx`
- `packages/web/components/ui/SendButton.stories.tsx`
- `packages/web/components/ui/SidebarSection.stories.tsx`
- `packages/web/components/ui/AgentBadge.stories.tsx`
- `packages/web/components/ui/DragDropOverlay.stories.tsx`
- `packages/web/components/ui/SwipeableCard.stories.tsx`
- `packages/web/components/ui/NavigationItem.stories.tsx`
- `packages/web/components/ui/AnimatedModal.stories.tsx`
- `packages/web/components/ui/FileAttachButton.stories.tsx`
- `packages/web/components/ui/GlassCard.stories.tsx`
- `packages/web/components/ui/ChatTextarea.stories.tsx`
- `packages/web/components/ui/NavigationButton.stories.tsx`
- `packages/web/components/ui/ChatInputComposer.stories.tsx`
- `packages/web/components/ui/AdvancedSettingsCollapse.stories.tsx`
- `packages/web/components/ui/ThemeSelector.stories.tsx`
- `packages/web/components/ui/ExpandableHeader.stories.tsx`
- `packages/web/components/ui/InfoSection.stories.tsx`
- `packages/web/components/ui/VaporBackground.stories.tsx`
- `packages/web/components/ui/MessageText.stories.tsx`
- `packages/web/components/ui/InfoIconButton.stories.tsx`
- `packages/web/components/ui/MessageHeader.stories.tsx`
- `packages/web/components/ui/OnboardingHero.stories.tsx`
- `packages/web/components/ui/StreamingIndicator.stories.tsx`
- `packages/web/components/ui/AccentSelect.stories.tsx`
- `packages/web/components/ui/MessageBubble.stories.tsx`
- `packages/web/components/ui/AccentInput.stories.tsx`
- `packages/web/components/ui/OnboardingActions.stories.tsx`

#### Feature Components (17)
- `packages/web/components/settings/panels/UISettingsPanel.stories.tsx`
- `packages/web/components/chat/EnhancedChatInput.stories.tsx`
- `packages/web/components/layout/__stories__/MobileSidebar.stories.tsx`
- `packages/web/components/layout/__stories__/Sidebar.stories.tsx`
- `packages/web/components/layout/MobileSidebar.stories.tsx`
- `packages/web/components/layout/Sidebar.stories.tsx`
- `packages/web/components/modals/TaskBoardModal.stories.tsx`
- `packages/web/components/feedback/FeedbackMiniDisplay.stories.tsx`
- `packages/web/components/feedback/PerformancePanel.stories.tsx`
- `packages/web/components/feedback/FeedbackInsightCard.stories.tsx`
- `packages/web/components/feedback/FeedbackDisplay.stories.tsx`
- `packages/web/components/feedback/FeedbackEventCard.stories.tsx`
- `packages/web/components/feedback/PredictivePanel.stories.tsx`
- `packages/web/components/files/CarouselCodeChanges.stories.tsx`
- `packages/web/components/files/FileDiffViewer.stories.tsx`
- `packages/web/components/timeline/tool/file-write.stories.tsx`
- `packages/web/components/organisms/GoogleDocChatMessage.stories.tsx`

### 🔴 PARK (10 stories) - Archive for now
*Complex/page-level components or legacy components with minimal current use*

- `packages/web/components/timeline/AnimatedTimelineView.stories.tsx` - Complex animated component
- `packages/web/components/timeline/AnimatedTypingIndicator.stories.tsx` - Complex animated component
- `packages/web/components/timeline/UnknownEventEntry.stories.tsx` - Edge case component
- `packages/web/components/timeline/AnimatedTimelineMessage.stories.tsx` - Complex animated component  
- `packages/web/components/timeline/TimelineView.stories.tsx` - Complex page-level component
- `packages/web/components/timeline/TimelineMessage.stories.tsx` - Complex feature component
- `packages/web/components/timeline/TypingIndicator.stories.tsx` - Complex animated component
- `packages/web/components/timeline/IntegrationEntry.stories.tsx` - Complex feature component
- `packages/web/components/pages/ChatInterface.stories.tsx` - Page-level component
- `packages/web/components/pages/LaceApp.stories.tsx` - App-level component
- `packages/web/components/pages/AnimatedLaceApp.stories.tsx` - Complex app-level component
- `packages/web/components/organisms/onboarding/OnboardingWizard.stories.tsx` - Complex multi-step component

## Next Steps

1. **Install Ladle**: `npm install -D @ladle/react`
2. **Configure Ladle**: Create `ladle.config.mjs` 
3. **Migrate KEEP stories**: Convert to CSF3 format for Ladle
4. **Create /play page**: Setup playground for CONVERT components
5. **Create MDX templates**: Document component usage
6. **Archive PARK stories**: Move to `stories_parked/` directory
7. **Update CI**: Replace Storybook build with optional Ladle job

## Expected Benefits

- ⚡ **Faster dev startup**: Ladle starts in seconds vs minutes for Storybook
- 🎯 **Focused tooling**: Only maintain stories for true primitives
- 📚 **Better docs**: MDX files provide clearer usage examples
- 🧪 **Rapid prototyping**: /play page for quick component testing
- 🧹 **Reduced complexity**: Less tooling maintenance overhead