# Onboarding design system: add atoms/molecules + Storybook; normalize taxonomy

## Summary
- Adds reusable atoms and molecules for the dim/glass onboarding design.
- Creates Storybook stories with controls and accessible focus-visible rings.
- Normalizes Storybook taxonomy to existing top-level Atoms/Molecules/Organisms (removes “Design System” root).
- No runtime logic changes to onboarding flow.

## Changes
- New atoms in `packages/web/components/ui/`:
  - InfoIconButton (`InfoIconButton.tsx` + `InfoIconButton.stories.tsx`)
  - AccentInput (`AccentInput.tsx` + `AccentInput.stories.tsx`)
  - AccentSelect (`AccentSelect.tsx` + `AccentSelect.stories.tsx`)
- New molecules in `packages/web/components/ui/`:
  - OnboardingHero (`OnboardingHero.tsx` + `OnboardingHero.stories.tsx`)
  - OnboardingActions (`OnboardingActions.tsx` + `OnboardingActions.stories.tsx`)
  - InfoSection (`InfoSection.tsx` + `InfoSection.stories.tsx`)
  - AdvancedSettingsCollapse (`AdvancedSettingsCollapse.tsx` + `AdvancedSettingsCollapse.stories.tsx`)
- Storybook titles updated to top-level taxonomy:
  - Atoms/AccentInput, Atoms/AccentSelect, Atoms/InfoIconButton
  - Molecules/Onboarding/OnboardingHero
  - Molecules/Onboarding/OnboardingActions
  - Molecules/Onboarding/InfoSection
  - Molecules/Onboarding/AdvancedSettingsCollapse

## Notes
- Components use dim/glass styling and emerald/turquoise accent consistent with `app/globals.css`.
- `InfoIconButton` imports `faInfo` from `@fortawesome/free-solid-svg-icons` for consistency.
- Existing app screens are untouched; this is componentization + Storybook coverage.

## Testing
- Storybook: run `npm run storybook` in `packages/web`
  - Verify sidebar grouping:
    - Atoms: AccentInput, AccentSelect, InfoIconButton
    - Molecules/Onboarding: OnboardingHero, OnboardingActions, InfoSection, AdvancedSettingsCollapse
  - Check focus-visible rings, hover states, disabled/invalid controls
- App build: `npm run build` in `packages/web` succeeds (Next 15.3.5)

## Screenshots
- Optional: attach screenshots of each story (dim/light as applicable).

## Risk/Impact
- Low. New components and story files only.
- Minimal styling risk if shared utilities change.

## Follow-ups
- Add Organism story for OnboardingWizard (compose molecules).
- Refactor `components/config/ProjectSelectorPanel.tsx` to consume new atoms/molecules incrementally.
- Ensure `GlassCard`, `VaporBackground`, `AccentButton` stories appear under Atoms if any titles are still out of place.
