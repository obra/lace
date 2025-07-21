# 🎨 Lace Animation System

## Overview

This document outlines the comprehensive animation system implemented in Lace using Framer Motion. The system provides best-in-class animations with smooth transitions, micro-interactions, and gesture-based controls.

## 🚀 Key Features

### ✨ Core Animation Library (`@/lib/animations.ts`)

**Spring Configurations:**
- `gentle` - Soft, natural animations for UI transitions
- `snappy` - Quick, responsive animations for interactions
- `bouncy` - Playful animations with spring bounce
- `smooth` - Polished animations for modals and large components
- `stiff` - Precise animations for data visualization

**Animation Variants:**
- **Fade Animations**: `fadeInUp`, `fadeInDown`, `fadeInLeft`, `fadeInRight`
- **Scale Animations**: `scaleIn`, `popIn`
- **Stagger Animations**: `staggerContainer`, `staggerItem`
- **Hover Effects**: `hoverScale`, `hoverLift`, `buttonTap`
- **Modal Animations**: `modalOverlay`, `modalContent`
- **Page Transitions**: `pageTransition`
- **Loading Animations**: `loadingDots`, `shimmer`, `typingIndicator`

### 🎯 Enhanced Components

#### 1. **AnimatedTimelineMessage** (`@/components/timeline/AnimatedTimelineMessage.tsx`)
- Staggered message appearance with delay based on index
- Animated avatars with rotation and scale effects
- Typing indicators with pulsing rings
- Smooth tool execution feedback
- Carousel integration with animated cards

#### 2. **AnimatedTimelineView** (`@/components/timeline/AnimatedTimelineView.tsx`)
- Staggered container animations for message groups
- Smooth auto-scroll with momentum scrolling (iOS optimized)
- Animated scroll-to-bottom button with path drawing
- Smooth typing indicator transitions
- Performance-optimized with capped delays

#### 3. **AnimatedCarousel** (`@/components/timeline/AnimatedCarousel.tsx`)
- Smooth page-based navigation with spring physics
- Drag gesture support with elastic constraints
- Progressive loading of carousel items
- Enhanced navigation arrows with hover states
- Animated progress indicator
- Touch-optimized for mobile devices

#### 4. **AnimatedLaceApp** (`@/components/pages/AnimatedLaceApp.tsx`)
- Full application animation with staggered component reveals
- Smooth page transitions and state changes
- Gesture-based interactions for mobile
- Coordinated sidebar and content animations

#### 5. **AnimatedButton** (`@/components/ui/AnimatedButton.tsx`)
- Multiple animation presets: `hover`, `tap`, `loading`
- Configurable spring physics and timing
- Icon integration with synchronized animations
- Accessible state management

#### 6. **AnimatedModal** (`@/components/ui/AnimatedModal.tsx`)
- Smooth backdrop fade with content scale
- Gesture-based dismissal on mobile
- Focus trap with animated transitions
- Portal-based rendering for z-index management

### 🛠 Implementation Guidelines

#### Performance Best Practices
1. **Use `will-change` CSS property** for animated elements
2. **Prefer transform and opacity** over layout-affecting properties
3. **Use `AnimatePresence`** for mount/unmount animations
4. **Implement gesture controls** for mobile-first experiences
5. **Cap stagger delays** to prevent excessive animation times

#### Animation Timing
- **Micro-interactions**: 150-250ms
- **Component transitions**: 300-500ms
- **Page transitions**: 500-800ms
- **Loading states**: 1000ms+ (with escape hatches)

#### Accessibility
- Respect `prefers-reduced-motion` media query
- Provide immediate completion for critical actions
- Use semantic HTML for screen reader compatibility
- Ensure focus management during animations

### 📱 Mobile Optimizations

#### Touch Gestures
- **Pan gestures** for carousel navigation
- **Tap gestures** with haptic feedback
- **Drag gestures** for modal dismissal
- **Momentum scrolling** for timeline views

#### Performance
- **Reduced complexity** on lower-end devices
- **Optimized re-renders** with `useMemo` and `useCallback`
- **GPU acceleration** for transform-based animations
- **Intersection observers** for viewport-based triggers

### 🎨 Design Tokens

#### Timing Functions
```typescript
const easing = {
  easeInOut: [0.4, 0, 0.2, 1],
  easeOut: [0, 0, 0.2, 1],
  easeIn: [0.4, 0, 1, 1],
  sharp: [0.4, 0, 0.6, 1],
}
```

#### Duration Scale
```typescript
const duration = {
  instant: 0,
  fast: 150,
  normal: 300,
  slow: 500,
  slower: 800,
}
```

## 🚨 Migration Notes

When importing this animation system:

1. **Update import paths** from `~/lib/animations` to `@/lib/animations`
2. **Verify Framer Motion version** compatibility (v10.16.0+)
3. **Test gesture behaviors** on target devices
4. **Validate accessibility** with screen readers
5. **Monitor performance** on lower-end hardware

## 📚 Resources

- [Framer Motion Documentation](https://www.framer.com/motion/)
- [Animation Best Practices](https://web.dev/animations-guide/)
- [Mobile Gesture Guidelines](https://material.io/design/interaction/gestures.html)