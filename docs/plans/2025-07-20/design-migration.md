# Design System Migration Plan: Phases 2-4

**Context:** We have imported a comprehensive atomic design system into the Lace AI assistant codebase. Phase 1 (chat input upgrade) is complete. This document covers migrating the remaining UI components to use the design system.

**Prerequisites:**
- React 18+ experience
- Basic TypeScript knowledge  
- Understanding of atomic design principles

**Architecture Overview:**
- **Lace** = AI assistant application with chat interface
- **Agents** = AI models (Claude, GPT-4) that respond to messages
- **Sessions** = Conversations with multiple agents
- **Events** = Real-time stream of messages, tool calls, responses

---

## Phase 2: Message & Content Display

**Goal:** Replace custom message rendering with design system components.

**Impact:** High - messages are the primary UI users interact with.

**Current State:** `ConversationDisplay` component renders events in a terminal-style layout.

### Task 2.1: Analyze Current Message Rendering

**Files to examine:**
- `packages/web/components/old/ConversationDisplay.tsx` - Current message display logic
- `packages/web/types/api.ts` - SessionEvent types
- `packages/web/app/page.tsx` - How ConversationDisplay is used

**What to understand:**
1. **Event types** - USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_RESULT, AGENT_TOKEN
2. **Event processing** - How streaming tokens are merged into complete messages
3. **Filtering logic** - How events are filtered by selected agent
4. **Current styling** - Terminal-like color coding and layout

**Test the current system:**
```bash
cd packages/web
npm run dev
# Create session → spawn agent → send messages → observe rendering
```

**Expected outcome:** Understanding of current event flow and rendering logic.

**Commit:** `docs: document current message rendering system for migration`

### Task 2.2: Create Message Display Component Tests

**Principle:** TDD - write tests before implementation.

**File to create:** `packages/web/components/ui/__tests__/LaceMessageDisplay.test.tsx`

**Test cases to write:**
```typescript
// Test structure - fill in implementation
describe('LaceMessageDisplay', () => {
  test('renders user message with timestamp', () => {});
  test('renders agent message with agent badge', () => {});
  test('renders tool call with parameters', () => {});
  test('renders tool result with success state', () => {});
  test('renders streaming message with indicator', () => {});
  test('handles empty content gracefully', () => {});
});
```

**Run tests:**
```bash
npm run test -- --testPathPattern=LaceMessageDisplay.test.tsx
```

**Expected outcome:** Failing tests that define the interface.

**Commit:** `test: add failing tests for LaceMessageDisplay component`

### Task 2.3: Build LaceMessageDisplay Component

**File to create:** `packages/web/components/ui/LaceMessageDisplay.tsx`

**Design system components to use:**
- `MessageBubble` - Chat bubble styling
- `MessageHeader` - Timestamp, agent info  
- `AgentBadge` - Agent identification
- `CodeBlock` - Tool parameters/results
- `StreamingIndicator` - Real-time typing

**Component interface:**
```typescript
interface LaceMessageDisplayProps {
  event: SessionEvent;
  agent?: Agent;
  isStreaming?: boolean;
}
```

**Implementation approach:**
1. Switch on `event.type` to render different message types
2. Use `MessageBubble` for USER_MESSAGE and AGENT_MESSAGE
3. Use `CodeBlock` for tool calls and results
4. Show `StreamingIndicator` for incomplete messages
5. Include `MessageHeader` with timestamp and agent info

**Styling guidelines:**
- User messages: right-aligned, blue theme
- Agent messages: left-aligned, green theme  
- Tool calls: code-style formatting
- System messages: gray, centered

**Test while building:**
```bash
npm run test -- --testPathPattern=LaceMessageDisplay.test.tsx --watch
```

**Expected outcome:** Green tests, working component.

**Commit:** `feat: implement LaceMessageDisplay with design system components`

### Task 2.4: Create Message List Component Tests

**File to create:** `packages/web/components/ui/__tests__/LaceMessageList.test.tsx`

**Test cases:**
```typescript
describe('LaceMessageList', () => {
  test('renders list of messages in chronological order', () => {});
  test('filters messages by selected agent', () => {});
  test('merges streaming tokens into complete messages', () => {});
  test('handles empty event list', () => {});
  test('scrolls to bottom on new messages', () => {});
});
```

**Commit:** `test: add failing tests for LaceMessageList component`

### Task 2.5: Build LaceMessageList Component  

**File to create:** `packages/web/components/ui/LaceMessageList.tsx`

**Purpose:** Replace the message processing logic from `ConversationDisplay`.

**Component interface:**
```typescript
interface LaceMessageListProps {
  events: SessionEvent[];
  agents: Agent[];
  selectedAgent?: ThreadId;
  className?: string;
  isLoading?: boolean;
}
```

**Key logic to migrate:**
1. **Event filtering** by selected agent (lines 24-37 in ConversationDisplay)
2. **Stream processing** - merge AGENT_TOKEN events (lines 40-70)
3. **Auto-scroll** to bottom on new messages
4. **Loading state** handling

**Design system integration:**
- Use `LoadingDots` for loading states
- Use `Skeleton` for placeholder messages
- Proper spacing with Tailwind classes

**Commit:** `feat: implement LaceMessageList with event processing logic`

### Task 2.6: Replace ConversationDisplay with New Components

**File to modify:** `packages/web/app/page.tsx`

**Change:**
```typescript
// Replace this:
<ConversationDisplay
  events={events}
  agents={selectedSessionDetails?.agents || []}
  selectedAgent={selectedAgent as ThreadId}
  className="h-full p-4"
  isLoading={loading}
/>

// With this:  
<LaceMessageList
  events={events}
  agents={selectedSessionDetails?.agents || []}
  selectedAgent={selectedAgent as ThreadId}
  className="h-full p-4"
  isLoading={loading}
/>
```

**Add import:**
```typescript
import { LaceMessageList } from '@/components/ui/LaceMessageList';
```

**Test migration:**
```bash
npm run dev
# Test full conversation flow:
# 1. Create session
# 2. Spawn agent  
# 3. Send messages
# 4. Verify messages render correctly
# 5. Test agent switching
# 6. Test real-time streaming
```

**Expected outcome:** Same functionality, better visual design.

**Commit:** `feat: replace ConversationDisplay with design system message components`

### Task 2.7: Add Message Component Storybook Stories

**Files to create:**
- `packages/web/components/ui/LaceMessageDisplay.stories.tsx`
- `packages/web/components/ui/LaceMessageList.stories.tsx`

**Story examples needed:**
- User messages
- Agent messages  
- Tool calls with code
- Streaming states
- Error states
- Empty states

**Test Storybook:**
```bash
npm run storybook
# Navigate to new stories
# Verify visual appearance
# Test interactive controls
```

**Commit:** `docs: add Storybook stories for message components`

---

## Phase 3: Layout & Navigation

**Goal:** Replace custom sidebar with responsive design system components.

**Impact:** Medium - improves mobile experience and visual consistency.

**Current State:** Custom sidebar layout in `app/page.tsx` (lines 285-389).

### Task 3.1: Analyze Current Layout Structure

**Files to examine:**
- `packages/web/app/page.tsx` - Main layout structure
- `packages/web/app/globals.css` - Current styling
- Available design system components in Storybook:
  - Navigate to `http://localhost:6006/?path=/docs/organisms-sidebar--docs`
  - Navigate to `http://localhost:6006/?path=/docs/organisms-mobilesidebar--docs`

**Current layout breakdown:**
- **Sidebar** (lines 285-389): Project selection, sessions, agents
- **Main content** (lines 392-489): Conversation or tasks
- **Fixed layout** with manual responsive handling

**Mobile testing:**
```bash
npm run dev
# Resize browser to mobile width
# Note: sidebar doesn't collapse
# Note: horizontal scrolling issues
```

**Expected outcome:** Understanding of layout constraints and mobile issues.

**Commit:** `docs: document current layout structure and mobile issues`

### Task 3.2: Create Sidebar Content Component Tests

**File to create:** `packages/web/components/ui/__tests__/LaceSidebarContent.test.tsx`

**Test cases:**
```typescript
describe('LaceSidebarContent', () => {
  test('renders project selection section', () => {});
  test('renders session creation form when project selected', () => {});
  test('renders sessions list with proper selection', () => {});
  test('renders agent spawner and agent list', () => {});
  test('handles project switching correctly', () => {});
  test('handles session creation', () => {});
});
```

**Commit:** `test: add failing tests for LaceSidebarContent component`

### Task 3.3: Build LaceSidebarContent Component

**File to create:** `packages/web/components/ui/LaceSidebarContent.tsx`

**Purpose:** Extract sidebar logic from main page component.

**Design system components to use:**
- `SidebarSection` - Section headers
- `NavigationItem` - Clickable list items
- `IconButton` - Action buttons
- `Badge` - Item counts

**Component interface:**
```typescript
interface LaceSidebarContentProps {
  // Project management
  selectedProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectCreated: (project: ProjectInfo) => void;
  
  // Session management
  sessions: Session[];
  selectedSession: ThreadId | null;
  sessionName: string;
  setSessionName: (name: string) => void;
  onSessionSelect: (sessionId: ThreadId) => void;
  onSessionCreate: () => void;
  loading: boolean;
  
  // Agent management  
  selectedSessionDetails: Session | null;
  selectedAgent: ThreadId | null;
  onAgentSelect: (threadId: ThreadId) => void;
  onAgentSpawn: (agent: Agent) => void;
}
```

**Implementation approach:**
1. **Section organization** using `SidebarSection`
2. **Navigation styling** using `NavigationItem`
3. **Proper spacing** and visual hierarchy
4. **Responsive behavior** preparation

**Commit:** `feat: implement LaceSidebarContent with design system components`

### Task 3.4: Create Mobile-Responsive Layout Tests

**File to create:** `packages/web/components/ui/__tests__/LaceAppLayout.test.tsx`

**Test cases:**
```typescript
describe('LaceAppLayout', () => {
  test('renders desktop layout with sidebar visible', () => {});
  test('renders mobile layout with collapsible sidebar', () => {});
  test('handles sidebar toggle on mobile', () => {});
  test('maintains state during responsive changes', () => {});
});
```

**Use testing utilities:**
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

// Mock window.matchMedia for responsive testing
global.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: query.includes('768px') ? false : true,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
```

**Commit:** `test: add responsive layout tests for LaceAppLayout`

### Task 3.5: Build Responsive Layout Component

**File to create:** `packages/web/components/ui/LaceAppLayout.tsx`

**Design system components to use:**
- `Sidebar` - Desktop sidebar
- `MobileSidebar` - Mobile collapsible sidebar
- Responsive utilities from Tailwind

**Component interface:**
```typescript
interface LaceAppLayoutProps {
  sidebarContent: React.ReactNode;
  mainContent: React.ReactNode;
}
```

**Responsive behavior:**
- **Desktop** (≥768px): Fixed sidebar, main content beside it
- **Mobile** (<768px): Overlay sidebar, hamburger menu, full-width main content

**Implementation:**
```typescript
const [sidebarOpen, setSidebarOpen] = useState(false);
const isMobile = useMediaQuery('(max-width: 768px)');

return (
  <div className="min-h-screen bg-gray-900 text-gray-100">
    {isMobile ? (
      <MobileSidebar 
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      >
        {sidebarContent}
      </MobileSidebar>
    ) : (
      <Sidebar className="w-80">
        {sidebarContent}  
      </Sidebar>
    )}
    
    <main className={`${!isMobile ? 'ml-80' : ''}`}>
      {isMobile && (
        <button onClick={() => setSidebarOpen(true)}>
          <MenuIcon />
        </button>
      )}
      {mainContent}
    </main>
  </div>
);
```

**Commit:** `feat: implement responsive LaceAppLayout with design system`

### Task 3.6: Replace Main Layout with New Components

**File to modify:** `packages/web/app/page.tsx`

**Refactoring approach:**
1. **Extract sidebar content** to `LaceSidebarContent`
2. **Extract main content** to separate component
3. **Wrap in** `LaceAppLayout`

**New page structure:**
```typescript
export default function Home() {
  // ... existing state management ...
  
  const sidebarContent = (
    <LaceSidebarContent
      selectedProjectId={selectedProject}
      onProjectSelect={handleProjectSelect}
      // ... other props
    />
  );
  
  const mainContent = (
    <div className="flex-1 flex flex-col h-full">
      {/* Tab navigation and content */}
    </div>
  );
  
  return (
    <>
      <LaceAppLayout 
        sidebarContent={sidebarContent}
        mainContent={mainContent}
      />
      {/* Tool approval modal */}
    </>
  );
}
```

**Test responsive behavior:**
```bash
npm run dev
# Test desktop layout
# Resize to mobile - verify sidebar collapses
# Test mobile menu toggle
# Verify functionality preserved
```

**Commit:** `feat: replace custom layout with responsive design system layout`

---

## Phase 4: Modals & Overlays

**Goal:** Replace custom modals with design system components.

**Impact:** Medium - better animations and consistency.

**Current State:** `ToolApprovalModal` in `components/old/`.

### Task 4.1: Analyze Current Modal Implementation

**Files to examine:**
- `packages/web/components/old/ToolApprovalModal.tsx` - Current modal
- `packages/web/app/page.tsx` - Modal usage (lines 493-499)
- Design system modal in Storybook:
  - Navigate to `http://localhost:6006/?path=/docs/molecules-modal--docs`

**Current modal analysis:**
- **Purpose:** Get user approval for agent tool usage
- **Props:** `request`, `onDecision`, `onTimeout`  
- **Features:** Countdown timer, approve/deny buttons
- **Styling:** Custom overlay and positioning

**Expected outcome:** Understanding of modal requirements.

**Commit:** `docs: analyze current ToolApprovalModal for migration`

### Task 4.2: Create Modal Component Tests

**File to create:** `packages/web/components/ui/__tests__/LaceToolApprovalModal.test.tsx`

**Test cases:**
```typescript
describe('LaceToolApprovalModal', () => {
  test('renders tool approval request details', () => {});
  test('handles approve decision', () => {});
  test('handles deny decision', () => {});
  test('handles timeout countdown', () => {});
  test('calls onTimeout when timer expires', () => {});
  test('renders tool parameters as code block', () => {});
});
```

**Mock timer for tests:**
```typescript
vi.useFakeTimers();
// Test timeout behavior
vi.advanceTimersByTime(30000);
```

**Commit:** `test: add failing tests for LaceToolApprovalModal`

### Task 4.3: Build Tool Approval Modal

**File to create:** `packages/web/components/ui/LaceToolApprovalModal.tsx`

**Design system components to use:**
- `Modal` or `AnimatedModal` - Base modal
- `CodeBlock` - Tool parameters display
- `AnimatedButton` - Action buttons
- `Badge` - Tool name/status

**Component interface:**
```typescript
interface LaceToolApprovalModalProps {
  request: ToolApprovalRequestData;
  onDecision: (decision: ApprovalDecision) => void;
  onTimeout: () => void;
}
```

**Key features to implement:**
1. **Countdown timer** with visual indicator
2. **Tool details** formatted nicely
3. **Parameters** displayed in code block
4. **Action buttons** with proper styling
5. **Auto-timeout** after 30 seconds

**Modal content structure:**
```tsx
<AnimatedModal isOpen={true} onClose={() => {}}>
  <div className="p-6">
    <h2>Tool Approval Request</h2>
    <Badge>{request.toolName}</Badge>
    
    <CodeBlock language="json">
      {JSON.stringify(request.parameters, null, 2)}
    </CodeBlock>
    
    <div className="timer">
      {timeRemaining}s remaining
    </div>
    
    <div className="actions">
      <AnimatedButton onClick={() => onDecision('APPROVE')}>
        Approve
      </AnimatedButton>
      <AnimatedButton onClick={() => onDecision('DENY')}>
        Deny  
      </AnimatedButton>
    </div>
  </div>
</AnimatedModal>
```

**Commit:** `feat: implement LaceToolApprovalModal with design system`

### Task 4.4: Replace Old Modal with New Component

**File to modify:** `packages/web/app/page.tsx`

**Import change:**
```typescript
// Replace:
import { ToolApprovalModal } from '@/components/old/ToolApprovalModal';

// With:
import { LaceToolApprovalModal } from '@/components/ui/LaceToolApprovalModal';
```

**Component change:**
```typescript
// Replace:
{approvalRequest && (
  <ToolApprovalModal
    request={approvalRequest}
    onDecision={handleApprovalDecision}
    onTimeout={handleApprovalTimeout}
  />
)}

// With:
{approvalRequest && (
  <LaceToolApprovalModal
    request={approvalRequest}  
    onDecision={handleApprovalDecision}
    onTimeout={handleApprovalTimeout}
  />
)}
```

**Test modal functionality:**
```bash
npm run dev
# Create session → spawn agent → send message that requires tool approval
# Verify modal appears with proper styling
# Test approve/deny buttons  
# Test timeout behavior
# Verify smooth animations
```

**Expected outcome:** Same functionality with better visual design.

**Commit:** `feat: replace ToolApprovalModal with design system modal`

### Task 4.5: Add Modal Storybook Stories

**File to create:** `packages/web/components/ui/LaceToolApprovalModal.stories.tsx`

**Stories to include:**
- Default approval request
- Long parameter lists
- Different tool types
- Timeout countdown
- Loading states

**Interactive controls:**
- Tool name
- Parameters object
- Timeout duration

**Test in Storybook:**
```bash
npm run storybook
# Verify modal stories load
# Test interactive controls
# Check responsive behavior
```

**Commit:** `docs: add Storybook stories for LaceToolApprovalModal`

---

## Testing Strategy

### Unit Tests
```bash
# Run all component tests
npm run test

# Run specific test files
npm run test -- --testPathPattern=LaceMessage

# Watch mode during development  
npm run test:watch
```

### Integration Tests
```bash
# Test full app functionality
npm run dev
# Manual testing checklist:
# 1. Project creation/selection
# 2. Session management  
# 3. Agent spawning
# 4. Message sending/receiving
# 5. Tool approval flow
# 6. Responsive behavior
```

### Visual Testing
```bash
# Test component library
npm run storybook

# Visual regression testing (if Chromatic configured)
npm run chromatic
```

## Commit Message Format

Use conventional commits with descriptive bodies:

```
type(scope): short description

Longer explanation of changes, why they were made,
and what problem they solve.

- Specific change 1
- Specific change 2  

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `test`, `docs`, `refactor`
**Scopes:** `ui`, `layout`, `modal`, `message`

## Rollback Strategy

Each phase builds incrementally:
- **Phase 2:** Can revert to `ConversationDisplay` if issues
- **Phase 3:** Can revert to custom layout if responsive issues  
- **Phase 4:** Can revert to old modal if functionality broken

**Rollback command:**
```bash
git revert <commit-hash>
# Or restore specific files:
git checkout HEAD~1 -- packages/web/app/page.tsx
```

## Success Criteria

**Phase 2 Complete:**
- ✅ Messages render with design system components
- ✅ Real-time streaming works  
- ✅ Agent filtering works
- ✅ Visual improvements visible
- ✅ No functionality regressions

**Phase 3 Complete:**  
- ✅ Responsive layout works on mobile
- ✅ Sidebar collapses properly
- ✅ No horizontal scrolling on mobile
- ✅ All sidebar functionality preserved

**Phase 4 Complete:**
- ✅ Modals use design system components  
- ✅ Smooth animations
- ✅ Tool approval flow unchanged
- ✅ Better visual consistency

**Overall Success:**
- All existing functionality preserved
- Improved mobile experience  
- Consistent visual design
- Foundation for advanced features
- Maintainable component architecture