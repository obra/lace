# Plugin Registry Alignment Implementation Plan (Cohesive Design)

## Overview

Make the three plugin systems (Tools, Agents, Models) feel like they were designed together as part of one cohesive TypeScript product. Focus on APIs that "rhyme" - consistent patterns and naming without being overly generic.

## Current API Inconsistencies

**Tool Registry:**
- `registry.register(name, instance)` / `registry.callTool(name, method, params)`  
- `tool.getSchema()` returns `{name, description, methods}`

**Agent Registry:**
- Static objects in ROLES map, `getRole(name)` function
- Roles have `{name, systemPrompt, defaultModel, capabilities}`

**Model Registry:**
- `providers.set(name, instance)` / provider access via Map
- `provider.chat()`, `provider.getInfo()`, different method names

## Design Goals

1. **APIs that rhyme** - similar patterns across all three systems (registerTool/registerRole/registerProvider, getTool/getRole/getProvider)
2. **Consistent metadata** - all components describe themselves with `getMetadata()` 
3. **Similar registries** - `tool-registry.ts`, `agent-registry.ts`, `model-registry.ts`
4. **TypeScript throughout** - convert remaining JS to TS for consistency
5. **Usage guidance** - all components explain when/how to use them

## Implementation Plan

### ✅ Step 1: Standardize Tool Registry API - COMPLETED

**Implementation:**
- Added `usage_guidance?: string` field to `ToolSchema` interface
- Renamed `getSchema()` method to `getMetadata()` across all tools
- Updated `ToolRegistry` methods: `register()`, `getTool()`, `hasTool()`, `listTools()`
- Added comprehensive usage guidance to `AgentDelegateTool` from `agent-delegation-design.md`
- Updated all tool implementations and tests to use new API

### ✅ Step 2: Simplify Delegation Tool Interface - COMPLETED

**Implementation:**
- Replaced complex parameters with simplified interface: `purpose: string`, `specification: string`, `role?: string`
- Implemented auto-role selection logic based on purpose keywords ('analyze' → reasoning, 'implement' → execution, 'plan' → orchestrator)
- Combined purpose and specification into task description for delegation
- Kept underlying agent spawning infrastructure unchanged
- Updated usage guidance examples to use new interface

### Step 3: Create Agent Registry

**Prompt:**
> Create `src/agents/agent-registry.ts` that mirrors the tool registry pattern:
> - Export an `AgentRegistry` class with methods: `registerRole()`, `getRole()`, `hasRole()`, `listRoles()`
> - Add `getMetadata()` method to role objects that returns `{name, description, usage_guidance, systemPrompt, defaultModel, capabilities, ...}`
> - Add `usage_guidance` to each role explaining when to use that role vs others
> - Maintain backward compatibility with existing `role-registry.ts` functions
> - Convert to TypeScript if not already
> - Update tests

### Step 4: Create Model Registry

**Prompt:**
> Create `src/models/model-registry.ts` that mirrors the tool registry pattern:
> - Convert `src/models/model-provider.js` to TypeScript
> - Export a `ModelRegistry` class with methods: `registerProvider()`, `getProvider()`, `hasProvider()`, `listProviders()`
> - Add `getMetadata()` method to provider classes returning `{name, description, usage_guidance, supportedModels, capabilities, ...}`
> - Add usage guidance to each provider explaining their strengths and when to use them
> - Keep existing specialized methods (`planningChat()`, `executionChat()`, etc.)
> - Update tests

### Step 5: Ensure Consistent Integration

**Prompt:**
> Update integration points to use the new rhyming APIs:
> - Update agent creation to use new agent registry API
> - Update agent delegation to use new simplified interface  
> - Ensure all three registries work together seamlessly
> - Update any remaining references to old method names
> - Run full test suite to ensure everything works
> - Add integration test that demonstrates all three registries working together

## Success Criteria

After completing these steps, all three plugin systems should:

1. **Feel cohesive** - Same naming conventions, similar APIs for similar operations
2. **Be well-documented** - All components have usage guidance explaining when/how to use them
3. **Use TypeScript** - Consistent typing throughout all three systems
4. **Have simple, clear APIs** - Easy to understand and use, especially delegation
5. **Work reliably** - Comprehensive test coverage for all changes
6. **Maintain backward compatibility** - Existing code continues to work

## Design Principles Applied

✅ **APIs that rhyme** - All registries use similar patterns: `registerX()`, `getX()`, `hasX()`, `listXs()`
✅ **Consistent metadata** - All components have `getMetadata()` with usage guidance
✅ **TypeScript throughout** - Convert remaining JS to TS for consistency
✅ **Simple interfaces** - Clean, minimal APIs without over-engineering
✅ **Cohesive feel** - Three separate registries that feel like they were designed together

**Final API Pattern:**
- `ToolRegistry`: `registerTool()`, `getTool()`, `hasTool()`, `listTools()`
- `AgentRegistry`: `registerRole()`, `getRole()`, `hasRole()`, `listRoles()`  
- `ModelRegistry`: `registerProvider()`, `getProvider()`, `hasProvider()`, `listProviders()`

## Notes

- Each step should be implemented and tested before moving to the next
- Maintain backward compatibility throughout the migration
- Document all changes as they are made
- Add comprehensive JSDoc comments to all new interfaces and methods
- Test each change thoroughly before proceeding
- Keep the underlying functionality intact while improving the interfaces
- All new code and all updated code should be typescript
