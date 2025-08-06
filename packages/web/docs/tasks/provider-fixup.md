# Provider System Migration Remaining Tasks

## API Routes
- [x] File: app/api/sessions/[sessionId]/configuration/route.ts (Line 13): Still supports old provider enum `z.enum(['anthropic', 'openai', 'lmstudio', 'ollama'])` for backward compatibility - should be removed after migration is complete
- [x] File: app/api/sessions/[sessionId]/configuration/route.ts (Lines 13-17): Schema supports both old (`provider`, `model`) and new (`providerInstanceId`, `modelId`) field names for backward compatibility

## Type Definitions  
- [x] File: hooks/useEventStream.ts (Lines 56-57): AgentEvent interface still uses old fields `provider: string` and `model: string` instead of `providerInstanceId` and `modelId`
- [x] File: lib/event-stream-manager.ts (Lines 56-57): AgentSpawnedEvent interface still uses old fields `provider: string` and `model: string`

## Test Files
All test files appropriately use the new system or contain legitimate test data that should remain. The following files contain proper usage:
- API route tests use `catalogId` and proper provider instance patterns
- Component tests and stories use the new field names appropriately
- E2E tests properly configure provider instances

## Other Files
- [x] File: e2e/helpers/test-utils.ts (Line 221): Function signature uses old parameter names `provider: string, model: string` - should be updated to use provider instance concepts
- [ ] File: components/timeline/tool/delegate.tsx (Line 61): ModelBadge component parameter uses `model: string` - this is acceptable as it's just for display purposes
- [ ] File: components/ui/LLMModelBadge.tsx (Line 7): Interface uses `model: string` - this is acceptable as it's purely for UI display
- [ ] File: components/providers/ProviderCatalogCard.tsx (Lines 42-43): Hardcoded provider type matching ('anthropic', 'openai') - this is acceptable as it's for UI color mapping

## Files with Legitimate Usage (No Changes Needed)
- **ProviderCatalogCard.tsx**: Uses hardcoded provider names only for UI color/styling - this is legitimate
- **LLMModelBadge.tsx**: Uses model string for display formatting - this is legitimate UI logic
- **All test files**: Properly use new system or contain appropriate test data
- **Project configuration route**: Already properly updated to use new field names

## Summary
Total files requiring updates: **4**
- 1 API route (backward compatibility removal)  
- 2 type definition files (event interfaces)
- 1 E2E test utility function

Estimated effort: **2-3 hours**

## Completed - August 6, 2025

All provider system migration tasks have been completed:

1. **API Route Fixed**: Removed backward compatibility from `app/api/sessions/[sessionId]/configuration/route.ts`
   - Eliminated old provider enum supporting ['anthropic', 'openai', 'lmstudio', 'ollama']  
   - Removed support for legacy field names 'provider' and 'model'
   - Schema now only accepts `providerInstanceId` and `modelId` as required fields

2. **Type Definitions Updated**: Updated event interfaces to use new field names
   - `hooks/useEventStream.ts`: AgentEvent interface now uses `providerInstanceId` and `modelId`
   - `lib/event-stream-manager.ts`: AgentSpawnedEvent interface now uses `providerInstanceId` and `modelId`

3. **Test Utilities Updated**: Fixed E2E test helper function
   - `e2e/helpers/test-utils.ts`: Function signature updated to use `providerInstanceId` and `modelId` parameters

All changes maintain compilation without introducing new errors. The migration to the new provider system is now complete.

## Notes
- Most of the codebase has already been successfully migrated to the new providerInstanceId/modelId system
- The remaining items are primarily:
  1. Event system interfaces that need updating
  2. One backward compatibility schema that can be cleaned up  
  3. One test utility function signature
- UI components appropriately use provider/model strings for display purposes only
- All API endpoints and core business logic already use the new system correctly