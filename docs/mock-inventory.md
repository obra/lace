# Mock Inventory

## Essential Mocks (Keep)

### External Libraries & APIs
- **File**: `src/providers/anthropic-provider.test.ts`
- **Mock**: `@anthropic-ai/sdk`  
- **Reason**: Avoid making real API calls to Anthropic service, control responses for testing
- **Status**: ✅ Essential - External dependency

- **File**: `src/providers/openai-provider.test.ts`
- **Mock**: `openai`  
- **Reason**: Avoid making real API calls to OpenAI service, control responses for testing
- **Status**: ✅ Essential - External dependency

- **File**: `src/providers/lmstudio-provider.test.ts`
- **Mock**: `@lmstudio/sdk`  
- **Reason**: Avoid dependency on LMStudio being installed/running locally
- **Status**: ✅ Essential - External dependency

- **File**: `src/providers/retry-ollama-provider.test.ts`
- **Mock**: `ollama`  
- **Reason**: Avoid dependency on Ollama being installed/running locally
- **Status**: ✅ Essential - External dependency

- **File**: `src/config/prompt-manager.test.ts`
- **Mock**: `child_process`  
- **Reason**: Avoid executing real shell commands during tests
- **Status**: ✅ Essential - System dependency

- **File**: `src/utils/traffic-logger.test.ts`
- **Mock**: HAR recording modules (`./har-recorder`, `./fetch-interceptor`, etc)
- **Reason**: Avoid file I/O and network interception during tests
- **Status**: ✅ Essential - I/O operations

### Configuration & Environment
- **File**: `src/app.test.ts`, `src/cli-flow.test.ts`
- **Mock**: `~/config/env-loader`
- **Reason**: Control environment variables in tests without affecting actual environment
- **Status**: ✅ Essential - Environment isolation

- **File**: Multiple files
- **Mock**: `~/config/lace-dir`  
- **Reason**: Control database and config paths, avoid writing to real user directories
- **Status**: ✅ Essential - File system isolation

### Logging
- **File**: Multiple files
- **Mock**: `~/utils/logger`
- **Reason**: Prevent log noise during test runs, control log verification
- **Status**: ✅ Essential - Test output control

## Behavior Mocks (Remove)

### Core Business Logic
- **File**: `src/app.test.ts`
- **Mock**: `~/agents/agent`, `~/threads/thread-manager`, `~/tools/executor`
- **Problem**: Tests mock orchestration between core components instead of testing real integration
- **Status**: ❌ Needs fixing - Testing mock interactions instead of real behavior

- **File**: `src/tools/delegate.test.ts`
- **Mock**: `~/agents/agent`
- **Problem**: Mocks the agent being tested instead of using real agent with controlled inputs
- **Status**: ❌ Needs fixing - Should test real delegation behavior

### UI Components
- **File**: `src/interfaces/terminal/components/events/tool-renderers/*.test.tsx`
- **Mock**: `../hooks/useTimelineExpansionToggle`
- **Problem**: Mocks UI behavior instead of testing component integration with real hooks
- **Status**: ❌ Needs fixing - Should test real component behavior

### Internal Tools
- **File**: `src/sessions/session.test.ts`, `src/sessions/session-config-integration.test.ts`
- **Mock**: All tool implementations (`~/tools/implementations/*`)
- **Problem**: Tests session behavior with mock tools instead of real tool integration
- **Status**: ❌ Needs fixing - Should use real tools or test tools separately

## Special Cases (Review)

### Test Infrastructure
- **File**: Multiple files
- **Mock**: `server-only` 
- **Reason**: Next.js server-side module compatibility in test environment
- **Status**: 🔍 Review - May be necessary for Next.js testing

- **File**: `src/interfaces/terminal/components/events/tool-renderers/DelegateToolRenderer.test.tsx`
- **Mock**: `ink`
- **Problem**: Partially mocks Ink.js but may be necessary for terminal UI testing
- **Status**: 🔍 Review - Complex UI testing scenario

### Data Dependencies  
- **File**: `src/projects/project.test.ts`
- **Mock**: `~/sessions/session`
- **Problem**: Mocks related business logic instead of testing integration
- **Status**: ❌ Needs fixing - Should test real project-session integration

## Web Package Mocks (packages/web)

### Console Output Suppression
- **File**: Multiple API route tests
- **Mock**: `console.error`, `console.warn` with `vi.spyOn().mockImplementation(() => {})`
- **Reason**: Prevent test log noise, verify error handling without console output
- **Status**: ✅ Essential - Test output control

### Next.js Server Environment
- **File**: Multiple integration tests
- **Mock**: `server-only`
- **Reason**: Next.js compatibility in test environment
- **Status**: ✅ Essential - Framework requirement

### Problematic API Route Mocks
- **File**: `packages/web/app/api/projects/**/route.test.ts`
- **Mock**: `@/lib/server/lace-imports` (Project class)
- **Problem**: Tests mock the entire backend logic instead of testing real HTTP behavior
- **Status**: ❌ Needs fixing - Should test real API responses

- **File**: `packages/web/app/api/tasks/**/route.test.ts`
- **Mock**: `@/lib/server/session-service` (SessionService)
- **Problem**: Mocks session management instead of testing real service integration
- **Status**: ❌ Needs fixing - Should use real session service

- **File**: `packages/web/app/api/sessions/**/route.test.ts`
- **Mock**: All tool implementations, provider registry
- **Problem**: Tests API routes with completely mocked backend
- **Status**: ❌ Needs fixing - Should test real request/response flow

### ID Generation
- **File**: `packages/web/app/api/projects/[projectId]/sessions/__tests__/route.test.ts`
- **Mock**: `@/lib/utils/id-generator`
- **Reason**: Predictable IDs for test assertions
- **Status**: ✅ Essential - Test determinism

### Agent Management
- **File**: `packages/web/app/api/sessions/[sessionId]/agents/__tests__/route.test.ts`
- **Mock**: `@/lib/server/agent-utils`
- **Problem**: Mocks agent spawning instead of testing real agent lifecycle
- **Status**: ❌ Needs fixing - Should test real agent management

## Summary

### Essential Mocks: 12 categories
- External APIs (Anthropic, OpenAI, LMStudio, Ollama)
- System operations (child_process, file system)  
- Environment configuration (env-loader, lace-dir)
- Logging infrastructure (logger, console suppression)
- Next.js framework compatibility (server-only)
- Test determinism (ID generation)

### Problematic Mocks: 25+ files
- **Core Logic**: Agent, ThreadManager, ToolExecutor (src/)
- **API Routes**: Project, Session, Task management (web/)
- **Service Layer**: SessionService, all tools (both)
- **UI Integration**: Hooks, components (src/)

### Web-Specific Issues
- API routes test mock responses instead of real HTTP behavior
- Backend services completely mocked instead of integration tested
- Tool implementations mocked in session API tests

### Next Steps
1. Document essential mocks with explanatory comments
2. **Phase 3 Priority**: Fix API route tests to use real backends
3. Remove service layer mocks in favor of real integration
4. Focus tests on actual HTTP request/response behavior
