# Lace Web UX Design System Guide

## Overview

This guide outlines the proper use of our DaisyUI-based design system. Following these principles ensures visual consistency, maintainability, and professional UX throughout the Lace web interface.

## Core Design Principles

### 1. Design Elements vs UI Elements

**Critical Distinction**: Not all colors should be theme-based. Understand the difference:

#### Design Elements (Brand/Identity)
- **Purpose**: Visual branding, aesthetic appeal, marketing identity
- **Behavior**: Remain consistent across themes to maintain brand recognition
- **Color Approach**: Hardcoded brand colors are acceptable and often required
- **Examples**: Hero gradients, logo colors, marketing CTAs, brand illustrations

```tsx
// ✅ CORRECT: Brand/design elements - consistent across themes
<div className="bg-gradient-to-br from-emerald-500 to-cyan-400">Hero Section</div>
<button className="bg-gradient-to-r from-emerald-600 to-cyan-500">Download Lace</button>
```

#### UI Elements (Functional/Interactive) 
- **Purpose**: User interaction, system feedback, navigation, status indication
- **Behavior**: Must adapt to themes for accessibility and user preference
- **Color Approach**: Always use semantic theme colors
- **Examples**: Selection states, status indicators, form validation, navigation highlights

```tsx
// ✅ CORRECT: UI/functional elements - theme-aware
<div className={isActive ? "border-primary" : "border-base-300"}>Tab</div>
<div className="bg-success text-success-content">Success Status</div>
```

#### Decision Questions
Ask yourself:
1. **Does it represent the Lace brand identity?** → Design element (hardcoded OK)
2. **Does it indicate system state or user interaction?** → UI element (theme-based required)
3. **Should it look identical in marketing materials?** → Design element
4. **Does the user interact with it functionally?** → UI element

### 2. Semantic Color Usage

Colors have meaning. Use the right semantic color for the right purpose:

```tsx
// ✅ CORRECT: Semantic color usage
<button className="btn btn-primary">Primary Action</button>
<div className="alert alert-error">Error message</div>
<span className="text-success">Success indicator</span>

// ❌ WRONG: Random color selection
<button className="bg-purple-500">Some action</button>
<div className="bg-red-300">Some message</div>
```

### 3. Consistent Interaction States

Use the same color for the same type of interaction across all components:

```tsx
// ✅ CORRECT: All selection states use primary
<button className={isSelected ? "border-primary bg-primary/10" : "border-base-300"}>
<div className={isActive ? "border-primary text-primary" : "text-base-content/70"}>
```

## DaisyUI Color System

### Semantic Colors

| Color | Usage | Example |
|-------|-------|---------|
| `primary` | Brand identity, main CTAs, selection states | Primary buttons, active tabs, selected items |
| `secondary` | Supporting brand elements, secondary actions | Secondary buttons, sub-navigation |
| `accent` | Decorative highlights, tertiary actions | Badges, small accents, decorative elements |
| `success` | Positive feedback, completion states | Success messages, completed items |
| `warning` | Caution, attention needed | Warning messages, pending states |
| `error` | Problems, destructive actions | Error messages, delete buttons |
| `info` | Neutral information | Info messages, tooltips |

### Base Colors

| Color | Usage |
|-------|-------|
| `base-100` | Main background |
| `base-200` | Card/section backgrounds |
| `base-300` | Borders, dividers |
| `base-content` | Primary text |

### Content Colors

Always pair colors with their content variants for proper contrast:

```tsx
// ✅ CORRECT: Proper contrast pairing
<div className="bg-primary text-primary-content">
<div className="bg-success text-success-content">

// ❌ WRONG: Manual color combinations
<div className="bg-primary text-white">
```

## Lace-Specific Color Extensions

### Agent Colors vs User Colors vs UI Colors

**Three distinct color categories with different rules:**

#### Agent Colors (AI Identity)
Use custom agent properties for AI agent representation:

```tsx
// ✅ CORRECT: Agent-specific colors
<div className="bg-[rgb(var(--agent-claude))] text-white">Claude Avatar</div>
<div className="bg-[rgb(var(--agent-gpt4))] text-white">GPT-4 Avatar</div>
<div className="bg-[rgb(var(--agent-gemini))] text-white">Gemini Avatar</div>

// ❌ WRONG: Using UI colors for agents
<div className="bg-primary">Claude</div>
```

#### User Colors (User Identity)
Use user CSS custom properties for user-related elements:

```tsx
// ✅ CORRECT: User-related elements use user theme colors
<div className="bg-[rgb(var(--user-primary))] text-white">User Avatar</div>
<div className="bg-[rgb(var(--user-primary))]/20 text-[rgb(var(--user-primary))]">User Message</div>
<button className="text-[rgb(var(--user-primary))] hover:bg-[rgb(var(--user-primary))]/10">User Action</button>

// ❌ WRONG: Hardcoded colors for user elements  
<div className="bg-teal-600">User Avatar</div>
// ❌ WRONG: Using UI colors for user elements
<div className="bg-primary">User Avatar</div>
```

#### UI Colors (System/Interface)
Use semantic theme colors for all interface elements:

```tsx
// ✅ CORRECT: UI elements use semantic colors
<div className={isSelected ? "border-primary" : "border-base-300"}>Selection</div>
<div className="bg-success text-success-content">Status</div>

// ❌ WRONG: Hardcoded colors for UI
<div className="bg-green-500">Status</div>
```

#### When to Use Which:
- **Agent Colors**: AI avatar, agent identity, agent-specific elements
- **User Colors**: User avatar, user messages, user-specific elements  
- **UI/Theme Colors**: Selection states, status indicators, navigation, forms

Available custom properties:
- `--agent-claude`: Claude-specific brand color
- `--agent-gpt4`: GPT-4-specific brand color  
- `--agent-gemini`: Gemini-specific brand color
- `--user-primary`: User identity color (themeable)

## Component Patterns

### Selection States

**Consistent Rule**: All selection/active states use `primary`

```tsx
// Tabs
<button className={isActive ? "border-primary text-primary bg-primary/5" : "border-transparent"}>

// Options/Cards
<div className={isSelected ? "border-primary ring-2 ring-primary/20" : "border-base-300"}>

// Toggle States
<div className={isOn ? "bg-primary text-primary-content" : "bg-base-300"}>
```

### Interactive States

```tsx
// Hover states - lighten the semantic color
<button className="btn btn-primary hover:btn-primary/90">

// Focus states - use accent for focus rings
<input className="input focus:ring-2 focus:ring-accent/50">

// Disabled states - use base colors with opacity
<button className="btn btn-primary disabled:bg-base-300 disabled:text-base-content/40">
```

### Status Indicators

```tsx
// Priority levels
<span className="badge badge-error">High Priority</span>
<span className="badge badge-warning">Medium Priority</span>
<span className="badge badge-success">Low Priority</span>

// Task status
<div className="bg-success/10 text-success border border-success/20">Complete</div>
<div className="bg-warning/10 text-warning border border-warning/20">In Progress</div>
<div className="bg-error/10 text-error border border-error/20">Failed</div>
```

## Layout & Structure

### Spacing Scale

Use Tailwind's consistent spacing scale:

```tsx
// ✅ CORRECT: Consistent spacing
<div className="p-4 mb-6 gap-3">
<div className="px-6 py-4">

// ❌ WRONG: Random spacing
<div className="p-[13px] mb-[23px]">
```

### Typography Hierarchy

```tsx
// Headers
<h1 className="text-2xl font-bold text-base-content">
<h2 className="text-xl font-semibold text-base-content">
<h3 className="text-lg font-medium text-base-content">

// Body text
<p className="text-base text-base-content">
<p className="text-sm text-base-content/80">Secondary text</p>
<p className="text-xs text-base-content/60">Helper text</p>
```

## Advanced Patterns

### Glass/Blur Effects

```tsx
<div className="bg-base-100/90 backdrop-blur-md border border-base-300/50">
```

### Gradients

Use semantic colors for gradients:

```tsx
// ✅ CORRECT: Theme-aware gradients
<div className="bg-gradient-to-r from-primary to-secondary">

// ✅ CORRECT: Lace accent gradient
<div className="bg-gradient-to-br from-emerald-500 to-cyan-400">
```

### Animations & Transitions

```tsx
// Standard transitions
<div className="transition-colors duration-200">
<div className="transition-all duration-300">

// Hover animations
<div className="hover:scale-105 transition-transform">
```

## Anti-Patterns to Avoid

### ❌ Don't Use Random Colors

```tsx
// WRONG: Random Tailwind colors
<div className="bg-purple-600 text-yellow-300">
<button className="bg-pink-500">
```

### ❌ Don't Mix Semantic Meanings

```tsx
// WRONG: Using primary for errors
<div className="bg-primary text-primary-content">Error occurred!</div>

// CORRECT: Use appropriate semantic color
<div className="bg-error text-error-content">Error occurred!</div>
```

### ❌ Don't Hardcode Theme Colors

```tsx
// WRONG: Hardcoded colors that won't change with themes
<div style={{backgroundColor: '#8b5cf6'}}>

// CORRECT: Theme-aware colors
<div className="bg-primary">
```

### ❌ Don't Use Different Colors for Same Interactions

```tsx
// WRONG: Inconsistent selection states
<TabA className={active ? "border-primary" : ""}>
<TabB className={active ? "border-accent" : ""}>

// CORRECT: Consistent selection states  
<TabA className={active ? "border-primary" : ""}>
<TabB className={active ? "border-primary" : ""}>
```

## Quick Reference: Component Colors

**"What color should I use for..."**

| Component Type | Color Choice | Example |
|---|---|---|
| **AI Agent Avatar** | Agent CSS properties | `bg-[rgb(var(--agent-claude))]` |
| **User Avatar** | User theme color | `bg-[rgb(var(--user-primary))] text-white` |
| **Active Tab** | Primary | `border-primary text-primary` |
| **Selected Item** | Primary | `border-primary ring-primary/20` |
| **Success Status** | Success semantic | `bg-success text-success-content` |
| **Error Message** | Error semantic | `bg-error text-error-content` |
| **Warning Alert** | Warning semantic | `bg-warning text-warning-content` |
| **Info Badge** | Info semantic | `bg-info text-info-content` |
| **Brand CTA** | Emerald gradient (hardcoded OK) | `bg-gradient-to-r from-emerald-500 to-cyan-400` |
| **Priority High** | Error | `text-error` |
| **Priority Medium** | Warning | `text-warning` |
| **Priority Low** | Success | `text-success` |

## Implementation Checklist

### For New Components:
- [ ] **Identify element type**: Design element, UI element, Agent, or User?
- [ ] **Choose appropriate colors**: Use Quick Reference table above
- [ ] **Ensure consistency**: All similar interactions use same color (e.g., all selections use `primary`)
- [ ] **Pair colors properly**: Background colors with matching content colors
- [ ] **Use Tailwind spacing**: Consistent spacing scale (p-4, mb-6, gap-3)
- [ ] **Follow typography hierarchy**: Proper heading and text scales
- [ ] **Test both themes**: Verify appearance in light and dark themes
- [ ] **Check accessibility**: Ensure proper contrast ratios

### For Cleaning Up Existing Components:
- [ ] **Identify hardcoded colors**: Look for `bg-blue-500`, `text-red-600`, etc.
- [ ] **Determine intent**: Is this design, UI, agent, or user related?
- [ ] **Replace appropriately**: Use Quick Reference table for correct replacement
- [ ] **Maintain visual hierarchy**: Don't change the visual meaning, just the color source
- [ ] **Test functionality**: Ensure interactive states still work correctly

## Theme Customization

Our themes define:

```js
// lace-dark theme
{
  primary: '#8b5cf6',      // Purple - main brand color
  secondary: '#06b6d4',    // Cyan - supporting brand
  accent: '#10b981',       // Emerald - decorative highlights
  success: '#10b981',      // Emerald - positive states
  warning: '#f59e0b',      // Amber - caution states
  error: '#ef4444',        // Red - negative states
  info: '#3b82f6',         // Blue - neutral info
}
```

## Getting Help

- **Design Questions**: Refer to this guide first
- **Component Examples**: Check existing components for patterns
- **New Patterns**: Discuss with the team before implementing

Remember: Consistency is more important than personal preference. When in doubt, follow existing patterns and use semantic colors appropriately.