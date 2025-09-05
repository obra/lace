# 📁 Parked Stories

This directory contains Storybook stories that have been **parked** during the
migration to a more focused development workflow.

## Why These Stories Are Parked

Stories in this directory fall into these categories:

- **Complex page-level components**: Full page components that are better tested
  through E2E tests
- **Complex animated components**: Heavy components with complex interactions
- **Edge case components**: Components handling specific edge cases with limited
  reuse
- **Legacy components**: Components with minimal current usage

## What This Means

- ❌ These stories are **not maintained** and may become outdated
- ❌ They are **not included** in any build or development workflows
- ✅ They are **preserved** for reference if needed in the future
- ✅ The actual components **still exist** and function normally in the
  application

## Accessing Parked Components

If you need to work with a parked component:

1. **For quick testing**: Add it to `/app/play/page.tsx` temporarily
2. **For development**: Create a focused test or example as needed
3. **For documentation**: Create an MDX file next to the component

## Migration Record

Stories were parked on: **[DATE]** as part of the Storybook → Ladle + Playground
migration.

See `STORYBOOK_TRIAGE.md` in the project root for the complete migration plan.
