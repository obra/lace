# Agent Creation Modal - Implementation Plan
*Date: 2025-09-11*

## Overview

This plan implements a new agent creation flow using a chat-widget-style modal that opens from a + button in the AGENTS sidebar section. The modal allows users to select a persona, model, and optionally send an initial message to create and start a conversation with a new agent.

## Design Summary

### User Flow
1. User clicks + button in AGENTS section sidebar (positioned like Tasks section + button)
2. Modal opens with chat-widget appearance
3. Modal has smart defaults: default Lace persona + current chat's model
4. User can customize persona (searchable dropdown) and model (existing selector)
5. User can optionally type initial message
6. Clicking Send creates agent and optionally sends first message
7. Modal closes, user can interact with new agent

### Key Design Principles
- **Smart Defaults**: One-click agent creation with sensible defaults
- **Chat-Widget UX**: Feels like messaging app, not traditional form
- **Optional Initial Message**: Create idle agent OR start conversation immediately
- **Reuse Existing Components**: ModelSelector, existing patterns

---

## Implementation Plan

### Prerequisites & Context

**Codebase Architecture**: Event-sourcing with SQLite persistence, React 19 + Next.js 15, TypeScript strict mode

**Key Directories**:
- `packages/core/src/` - Core logic, persona registry
- `packages/web/components/` - React components
- `packages/web/app/routes/` - API endpoints
- `packages/web/hooks/` - Custom React hooks

**Testing**: Vitest for unit/integration, Playwright for E2E, co-located test files

**Styling**: Tailwind CSS + DaisyUI components, strongly-typed wrappers

---

## ✅ Task 1: Create Persona Catalog API Endpoint (COMPLETED)

**Objective**: Expose PersonaRegistry data through REST API for frontend consumption

**Files to Create**:
- `packages/web/app/routes/api.persona.catalog.ts`

**Files to Reference**:
- `packages/web/app/routes/api.provider.catalog.ts` (pattern to follow)
- `packages/core/src/config/persona-registry.ts` (data source)

**Implementation**:

```typescript
// packages/web/app/routes/api.persona.catalog.ts
// ABOUTME: Persona catalog API endpoint
// ABOUTME: Returns available personas from PersonaRegistry for agent creation

import { personaRegistry } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { PersonaInfo } from '@/lib/server/lace-imports';
import type { Route } from './+types/api.persona.catalog';

export interface PersonaCatalogResponse {
  personas: PersonaInfo[];
}

export async function loader({ request: _request }: Route.LoaderArgs) {
  try {
    const personas = personaRegistry.listAvailablePersonas();
    
    return createSuperjsonResponse({ personas } as PersonaCatalogResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load persona catalog';
    return createErrorResponse(errorMessage, 500, {
      code: 'PERSONA_CATALOG_LOAD_FAILED',
    });
  }
}
```

**Testing**:
```typescript
// packages/web/app/routes/api.persona.catalog.test.ts
import { describe, it, expect } from 'vitest';
import { loader } from './api.persona.catalog';

describe('api.persona.catalog', () => {
  it('should return personas from registry', async () => {
    const mockRequest = new Request('http://localhost/api/persona/catalog');
    const response = await loader({ request: mockRequest, params: {}, context: {} });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.personas).toBeDefined();
    expect(Array.isArray(data.personas)).toBe(true);
  });
});
```

**Manual Testing**:
1. Start dev server: `npm run dev`
2. Visit `http://localhost:3000/api/persona/catalog`
3. Verify JSON response with personas array
4. Check both built-in and user-defined personas are included

**Commit Message**: `feat: add persona catalog API endpoint`

---

## ✅ Task 2: Add + Button to AgentsSection Header (COMPLETED)

**Objective**: Add a + button to AGENTS section header matching the existing Tasks section pattern

**Files to Modify**:
- `packages/web/components/sidebar/AgentsSection.tsx`

**Files to Reference**:
- `packages/web/components/sidebar/TaskSidebarSection.tsx` (pattern to follow, lines 71-80)
- `packages/web/components/layout/Sidebar.tsx` (SidebarSection component)

**Key Changes**:

1. Import necessary components:
```typescript
import { SidebarSection } from '@/components/layout/Sidebar';
import { faPlus } from '@/lib/fontawesome';
```

2. Add props for modal control:
```typescript
interface AgentsSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onAgentSelect: (agentId: ThreadId) => void;
  onCreateAgent?: () => void; // NEW
}
```

3. Create add button component:
```typescript
const addAgentButton = (
  <button
    onClick={onCreateAgent}
    className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
    title="Add agent"
    data-testid="add-agent-button"
  >
    <FontAwesomeIcon icon={faPlus} className="w-3 h-3 text-base-content/60" />
  </button>
);
```

4. Replace existing structure with SidebarSection:
```typescript
return (
  <SidebarSection
    title="Agents"
    icon={faRobot}
    defaultCollapsed={false}
    collapsible={true}
    headerActions={onCreateAgent ? addAgentButton : undefined}
  >
    <div className="space-y-0.5">
      {/* existing agent list content */}
    </div>
  </SidebarSection>
);
```

**Testing**:
```typescript
// packages/web/components/sidebar/__tests__/AgentsSection.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentsSection } from '../AgentsSection';

describe('AgentsSection', () => {
  it('should render add agent button when onCreateAgent provided', () => {
    const mockOnCreateAgent = vi.fn();
    render(
      <AgentsSection 
        onAgentSelect={vi.fn()} 
        onCreateAgent={mockOnCreateAgent} 
      />
    );
    
    const addButton = screen.getByTestId('add-agent-button');
    expect(addButton).toBeInTheDocument();
    
    fireEvent.click(addButton);
    expect(mockOnCreateAgent).toHaveBeenCalledOnce();
  });
});
```

**Manual Testing**:
1. Navigate to a session with agents in web UI
2. Verify + button appears in AGENTS section header
3. Verify button styling matches Tasks section + button
4. Click button (should error for now - modal not implemented yet)

**Commit Message**: `feat: add + button to agents section header`

---

## ✅ Task 3: Create Searchable Persona Dropdown Component (COMPLETED)

**Objective**: Build a reusable dropdown component for persona selection with search/autocomplete

**Files to Create**:
- `packages/web/components/ui/PersonaSelector.tsx`
- `packages/web/components/ui/__tests__/PersonaSelector.test.tsx`

**Files to Reference**:
- `packages/web/components/ui/ModelSelector.tsx` (pattern to follow)
- `packages/web/hooks/useApiData.ts` (if exists, for data fetching pattern)

**Implementation**:

```typescript
// packages/web/components/ui/PersonaSelector.tsx
// ABOUTME: Searchable persona dropdown component with autocomplete
// ABOUTME: Loads personas from catalog API and provides filtering

'use client';

import { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faUser } from '@/lib/fontawesome';
import type { PersonaInfo } from '@/types/core';

interface PersonaSelectorProps {
  personas: PersonaInfo[];
  selectedPersona?: string;
  onChange: (personaName: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function PersonaSelector({
  personas,
  selectedPersona,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'Select persona...',
}: PersonaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPersonas = useMemo(() => {
    if (!searchQuery) return personas;
    return personas.filter(persona => 
      persona.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [personas, searchQuery]);

  const selectedPersonaInfo = personas.find(p => p.name === selectedPersona);

  const handleSelect = (personaName: string) => {
    onChange(personaName);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 bg-base-100 border border-base-300 rounded-lg hover:border-base-400 focus:border-primary focus:outline-none"
        data-testid="persona-selector-trigger"
      >
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faUser} className="w-4 h-4 text-base-content/60" />
          <span className="text-sm">
            {selectedPersonaInfo?.name || placeholder}
          </span>
        </div>
        <FontAwesomeIcon 
          icon={faChevronDown} 
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg z-50 max-h-60 overflow-hidden">
          <div className="p-2 border-b border-base-300">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search personas..."
              className="w-full px-3 py-1.5 text-sm bg-base-200 rounded border-0 focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="persona-search-input"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filteredPersonas.length === 0 ? (
              <div className="px-3 py-2 text-sm text-base-content/60">
                No personas found
              </div>
            ) : (
              filteredPersonas.map((persona) => (
                <button
                  key={persona.name}
                  type="button"
                  onClick={() => handleSelect(persona.name)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-base-200 focus:bg-base-200 focus:outline-none"
                  data-testid={`persona-option-${persona.name}`}
                >
                  <FontAwesomeIcon icon={faUser} className="w-3 h-3 text-base-content/60" />
                  <div>
                    <div className="text-sm font-medium">{persona.name}</div>
                    <div className="text-xs text-base-content/60">
                      {persona.isUserDefined ? 'User Defined' : 'Built-in'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Testing**:
```typescript
// packages/web/components/ui/__tests__/PersonaSelector.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaSelector } from '../PersonaSelector';

const mockPersonas = [
  { name: 'default', isUserDefined: false, path: 'default.md' },
  { name: 'code-reviewer', isUserDefined: false, path: 'code-reviewer.md' },
  { name: 'my-custom', isUserDefined: true, path: '/path/to/my-custom.md' },
];

describe('PersonaSelector', () => {
  it('should render with placeholder when no selection', () => {
    render(
      <PersonaSelector
        personas={mockPersonas}
        onChange={vi.fn()}
        placeholder="Choose persona"
      />
    );
    
    expect(screen.getByText('Choose persona')).toBeInTheDocument();
  });

  it('should open dropdown and show personas on click', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} />);
    
    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    
    expect(screen.getByTestId('persona-search-input')).toBeInTheDocument();
    expect(screen.getByTestId('persona-option-default')).toBeInTheDocument();
    expect(screen.getByTestId('persona-option-code-reviewer')).toBeInTheDocument();
  });

  it('should filter personas based on search', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} />);
    
    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    fireEvent.change(screen.getByTestId('persona-search-input'), { target: { value: 'code' } });
    
    expect(screen.getByTestId('persona-option-code-reviewer')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-option-default')).not.toBeInTheDocument();
  });

  it('should call onChange when persona selected', () => {
    const mockOnChange = vi.fn();
    render(<PersonaSelector personas={mockPersonas} onChange={mockOnChange} />);
    
    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    fireEvent.click(screen.getByTestId('persona-option-code-reviewer'));
    
    expect(mockOnChange).toHaveBeenCalledWith('code-reviewer');
  });
});
```

**Manual Testing**:
1. Create a Storybook story or temporary page with PersonaSelector
2. Verify dropdown opens/closes on click
3. Test search functionality filters correctly
4. Test persona selection calls onChange
5. Test keyboard navigation (tab, enter, escape)

**Commit Message**: `feat: add searchable persona selector component`

---

## ✅ Task 4: Create Condensed Chat Input Component (COMPLETED)

**Objective**: Create a condensed version of the chat input suitable for modal usage

**Files to Investigate First**:
- `packages/web/components/chat/` (find existing chat input component)
- `packages/web/components/ui/` (look for input components)

**Strategy**: 
1. Find existing chat input component
2. Either add a `condensed` prop/mode OR create new component
3. Remove token usage, minimize padding, smaller font sizes

**Files to Create/Modify** (after investigation):
- Likely `packages/web/components/ui/CondensedChatInput.tsx` OR modify existing component

**Key Requirements**:
- Similar styling to main chat input but compact
- No token usage display
- Smaller dimensions suitable for modal
- Maintains placeholder, send button, keyboard shortcuts
- Should accept `value`, `onChange`, `onSend`, `placeholder`, `disabled` props

**Implementation Pattern**:
```typescript
// Example structure (actual file depends on investigation)
interface CondensedChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function CondensedChatInput({ 
  value, 
  onChange, 
  onSend, 
  placeholder = "Type a message...",
  disabled = false,
  className = '' 
}: CondensedChatInputProps) {
  // Compact styling with smaller padding, no extras
  // Handle Enter key for sending
  // Basic send button without extra UI elements
}
```

**Testing**:
- Should handle Enter key to send
- Should handle Shift+Enter for new lines
- Should disable send when empty and required
- Should call onSend with current value
- Should clear after sending (if desired)

**Investigation First**: Look at existing chat components before implementing

**Commit Message**: `feat: add condensed chat input component`

---

## ✅ Task 5: Create Agent Creation Modal Component (COMPLETED)

**Objective**: Build the main modal component that orchestrates persona selection, model selection, and chat input

**Files to Create**:
- `packages/web/components/modals/AgentCreateChatModal.tsx`
- `packages/web/components/modals/__tests__/AgentCreateChatModal.test.tsx`

**Files to Reference**:
- `packages/web/components/ui/Modal.tsx` (base modal component)
- `packages/web/components/config/AgentCreateModal.tsx` (existing modal for comparison)
- `packages/web/hooks/useAgentManagement.ts` (agent creation logic)

**Implementation**:

```typescript
// packages/web/components/modals/AgentCreateChatModal.tsx
// ABOUTME: Chat-widget style modal for creating new agents
// ABOUTME: Combines persona selection, model selection, and optional messaging

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { PersonaSelector } from '@/components/ui/PersonaSelector';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { CondensedChatInput } from '@/components/ui/CondensedChatInput';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@/lib/fontawesome';
import type { ProviderInfo, PersonaInfo } from '@/types/api';

interface AgentCreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateAgent: (config: {
    personaName: string;
    providerInstanceId: string;
    modelId: string;
    initialMessage?: string;
  }) => Promise<void>;
  
  // Data
  personas: PersonaInfo[];
  providers: ProviderInfo[];
  
  // Smart defaults
  defaultPersonaName?: string;
  defaultProviderInstanceId?: string;
  defaultModelId?: string;
  
  // Loading state
  creating?: boolean;
}

export function AgentCreateChatModal({
  isOpen,
  onClose,
  onCreateAgent,
  personas,
  providers,
  defaultPersonaName,
  defaultProviderInstanceId,
  defaultModelId,
  creating = false,
}: AgentCreateChatModalProps) {
  const [selectedPersona, setSelectedPersona] = useState(defaultPersonaName || '');
  const [selectedProviderInstanceId, setSelectedProviderInstanceId] = useState(defaultProviderInstanceId || '');
  const [selectedModelId, setSelectedModelId] = useState(defaultModelId || '');
  const [message, setMessage] = useState('');

  // Reset to defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPersona(defaultPersonaName || '');
      setSelectedProviderInstanceId(defaultProviderInstanceId || '');
      setSelectedModelId(defaultModelId || '');
      setMessage('');
    }
  }, [isOpen, defaultPersonaName, defaultProviderInstanceId, defaultModelId]);

  const canCreate = selectedPersona && selectedProviderInstanceId && selectedModelId;

  const handleSend = async () => {
    if (!canCreate) return;

    try {
      await onCreateAgent({
        personaName: selectedPersona,
        providerInstanceId: selectedProviderInstanceId,
        modelId: selectedModelId,
        initialMessage: message.trim() || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create agent:', error);
      // Error handling - maybe show toast or error state
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Agent"
      size="md"
      className="agent-create-chat-modal"
    >
      <div className="space-y-4">
        {/* Persona Selection */}
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-2">
            Who are you messaging?
          </label>
          <PersonaSelector
            personas={personas}
            selectedPersona={selectedPersona}
            onChange={setSelectedPersona}
            placeholder="Select persona..."
            className="w-full"
          />
        </div>

        {/* Message Input */}
        <div>
          <CondensedChatInput
            value={message}
            onChange={setMessage}
            onSend={handleSend}
            placeholder="Type a message (optional)..."
            disabled={creating}
            className="w-full"
          />
        </div>

        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-2">
            Model
          </label>
          <ModelSelector
            providers={providers}
            selectedProviderInstanceId={selectedProviderInstanceId}
            selectedModelId={selectedModelId}
            onChange={(providerInstanceId, modelId) => {
              setSelectedProviderInstanceId(providerInstanceId);
              setSelectedModelId(modelId);
            }}
            className="select select-bordered w-full"
            placeholder="Select model..."
          />
        </div>

        {/* Send Button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSend}
            disabled={!canCreate || creating}
            className="btn btn-primary flex items-center gap-2"
            data-testid="create-agent-send-button"
          >
            {creating ? (
              <>
                <div className="loading loading-spinner loading-sm"></div>
                Creating...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPaperPlane} className="w-4 h-4" />
                {message.trim() ? 'Send' : 'Create Agent'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

**Testing**:
```typescript
// packages/web/components/modals/__tests__/AgentCreateChatModal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentCreateChatModal } from '../AgentCreateChatModal';

const mockPersonas = [
  { name: 'default', isUserDefined: false, path: 'default.md' },
];

const mockProviders = [
  {
    instanceId: 'anthropic-1',
    displayName: 'Anthropic',
    configured: true,
    models: [{ id: 'claude-3', displayName: 'Claude 3' }],
  },
];

describe('AgentCreateChatModal', () => {
  it('should render with smart defaults', () => {
    render(
      <AgentCreateChatModal
        isOpen={true}
        onClose={vi.fn()}
        onCreateAgent={vi.fn()}
        personas={mockPersonas}
        providers={mockProviders}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    // Should show defaults selected
    expect(screen.getByDisplayValue('default')).toBeInTheDocument();
  });

  it('should enable send button when all required fields filled', () => {
    render(
      <AgentCreateChatModal
        isOpen={true}
        onClose={vi.fn()}
        onCreateAgent={vi.fn()}
        personas={mockPersonas}
        providers={mockProviders}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    expect(sendButton).not.toBeDisabled();
  });

  it('should call onCreateAgent with correct data', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);
    
    render(
      <AgentCreateChatModal
        isOpen={true}
        onClose={vi.fn()}
        onCreateAgent={mockOnCreateAgent}
        personas={mockPersonas}
        providers={mockProviders}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    fireEvent.click(screen.getByTestId('create-agent-send-button'));

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: undefined,
      });
    });
  });
});
```

**Manual Testing**:
1. Test modal opens/closes properly
2. Test smart defaults are applied
3. Test persona selection changes button text
4. Test message input enables/changes button text
5. Test validation (disabled button when missing required fields)

**Commit Message**: `feat: add agent creation chat modal component`

---

## ✅ Task 6: Integrate Modal with Parent Components (COMPLETED)

**Objective**: Wire the modal into the sidebar and connect it to actual agent creation logic

**Files to Modify**:
- `packages/web/components/sidebar/AgentsSection.tsx` (add modal usage)
- Parent component that renders AgentsSection (likely in `components/pages/` or similar)

**Files to Reference**:
- `packages/web/hooks/useAgentManagement.ts` (agent creation hook)
- `packages/web/components/config/SessionConfigPanel.tsx` (existing modal integration example)

**Key Integration Points**:

1. **Add modal state to parent component**:
```typescript
const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);
```

2. **Load required data**:
```typescript
// Fetch personas
const { data: personaData } = useSWR('/api/persona/catalog', fetcher);
const personas = personaData?.personas || [];

// Get providers (likely already available)
// Get current agent's model for defaults
```

3. **Connect to agent creation**:
```typescript
const { createAgent } = useAgentManagement();

const handleCreateAgent = async (config: AgentCreateConfig) => {
  await createAgent({
    sessionId: selectedSession.id,
    name: `${config.personaName} Agent`, // or generate name
    personaName: config.personaName,
    providerInstanceId: config.providerInstanceId,
    modelId: config.modelId,
  });
  
  // If initial message provided, send it
  if (config.initialMessage) {
    // Send message to newly created agent
  }
};
```

4. **Pass props to AgentsSection**:
```typescript
<AgentsSection
  onAgentSelect={handleAgentSelect}
  onCreateAgent={() => setShowCreateAgentModal(true)}
  // other props
/>
```

**Error Handling**:
- Wrap createAgent in try/catch
- Show error toast or modal error state on failure
- Don't close modal if creation fails

**Testing Integration**:
```typescript
// Integration test
it('should create agent when modal submitted', async () => {
  const mockCreateAgent = vi.fn().mockResolvedValue({ threadId: 'new-agent' });
  
  render(/* parent component with mocked useAgentManagement */);
  
  // Click + button
  fireEvent.click(screen.getByTestId('add-agent-button'));
  
  // Fill modal and submit
  // ... modal interactions
  
  await waitFor(() => {
    expect(mockCreateAgent).toHaveBeenCalled();
  });
});
```

**Manual Testing**:
1. Click + button opens modal
2. Submit with defaults creates agent successfully
3. Submit with custom persona/model works
4. Submit with message creates agent and sends message
5. Error handling shows appropriate feedback
6. Modal closes after successful creation

**Commit Message**: `feat: integrate agent creation modal with sidebar`

---

## ✅ Task 7: Handle Initial Message Sending (COMPLETED)

**Objective**: When user provides initial message, send it to newly created agent

**Files to Investigate**:
- `packages/web/hooks/useAgentManagement.ts` (message sending logic)
- Agent/messaging hooks and services

**Implementation Strategy**:
1. Modify agent creation flow to optionally accept initial message
2. After agent creation, if initial message provided, send it immediately
3. Ensure proper sequencing (agent created -> message sent -> UI updated)

**Key Considerations**:
- Agent must be fully created before sending message
- Message should appear in agent's conversation history
- Error handling if message sending fails after agent creation
- UI should reflect both agent creation and message sending states

**Testing**:
- Test agent creation without message (idle state)
- Test agent creation with message (sends and shows in conversation)
- Test error handling if message sending fails
- Test proper UI state transitions

**Commit Message**: `feat: support initial message sending for new agents`

---

## ✅ Task 8: Add Error Handling and Loading States (COMPLETED)

**Objective**: Robust error handling and clear loading states throughout the flow

**Error Scenarios**:
1. Persona catalog API fails to load
2. Agent creation fails
3. Initial message sending fails after agent creation
4. Network timeouts
5. Validation errors

**Loading States**:
1. Loading persona catalog
2. Creating agent
3. Sending initial message

**Implementation**:
- Add error boundaries around modal
- Show loading spinners during operations
- Toast notifications for errors
- Graceful degradation when persona catalog fails
- Retry mechanisms where appropriate

**Testing**:
- Mock API failures and test error displays
- Test loading states render correctly
- Test retry mechanisms work
- Test partial failures (agent created but message failed)

**Commit Message**: `feat: add comprehensive error handling and loading states`

---

## Task 9: End-to-End Testing

**Objective**: Comprehensive E2E tests covering the complete flow

**Files to Create**:
- `packages/web/e2e/agent-creation-modal.e2e.ts`

**Test Scenarios**:
1. **Happy Path - Quick Creation**: Click +, click Send (uses defaults)
2. **Happy Path - Custom Creation**: Click +, change persona/model, add message, send
3. **Search Functionality**: Click +, search for persona, select, create
4. **Validation**: Try to send without required fields
5. **Error Handling**: Test with API failures
6. **Cancellation**: Open modal, close without creating

**E2E Test Structure**:
```typescript
// packages/web/e2e/agent-creation-modal.e2e.ts
import { test, expect } from '@playwright/test';

test.describe('Agent Creation Modal', () => {
  test('should create agent with defaults', async ({ page }) => {
    // Navigate to session with agents
    await page.goto('/projects/test/sessions/test');
    
    // Click + button in agents section
    await page.getByTestId('add-agent-button').click();
    
    // Verify modal opens
    await expect(page.getByText('Who are you messaging?')).toBeVisible();
    
    // Click send (should use defaults)
    await page.getByTestId('create-agent-send-button').click();
    
    // Verify agent appears in sidebar
    await expect(page.getByText('default Agent')).toBeVisible();
    
    // Verify modal closes
    await expect(page.getByText('Who are you messaging?')).not.toBeVisible();
  });

  test('should create agent with custom message', async ({ page }) => {
    await page.goto('/projects/test/sessions/test');
    
    await page.getByTestId('add-agent-button').click();
    
    // Type initial message
    await page.fill('textarea[placeholder*="Type a message"]', 'Hello, help me code!');
    
    await page.getByTestId('create-agent-send-button').click();
    
    // Verify agent created and message sent
    // Check conversation shows the initial message
  });
});
```

**Manual E2E Testing**:
1. Test across different browsers
2. Test mobile responsiveness
3. Test with different session states
4. Test with various persona counts
5. Test keyboard navigation
6. Test accessibility (screen readers, tab navigation)

**Performance Testing**:
- Large persona lists (100+ personas)
- Search responsiveness
- Modal open/close animations
- API response times

**Commit Message**: `test: add comprehensive E2E tests for agent creation modal`

---

## Task 10: Documentation and Polish

**Objective**: Document the new feature and add final polish

**Documentation**:
1. Update component documentation
2. Add Storybook stories for new components
3. Update API documentation
4. Add user-facing feature documentation

**Polish**:
1. Animations and transitions
2. Accessibility improvements (ARIA labels, keyboard navigation)
3. Mobile responsiveness
4. Dark mode compatibility
5. Tooltip improvements

**Files to Update**:
- Component README files
- Storybook stories
- API documentation
- User documentation

**Final Testing**:
- Accessibility audit (axe-core)
- Cross-browser testing
- Mobile device testing
- Performance profiling
- Load testing with many personas

**Commit Message**: `docs: add documentation and polish for agent creation modal`

---

## Definition of Done

### Functional Requirements ✅
- [ ] + button appears in AGENTS section header
- [ ] Modal opens with chat-widget appearance  
- [ ] Persona dropdown with search works
- [ ] Model selector shows available models
- [ ] Smart defaults (default persona + current model) applied
- [ ] Can create agent without message (idle state)
- [ ] Can create agent with initial message
- [ ] Modal closes after successful creation
- [ ] New agent appears in sidebar
- [ ] Initial message (if provided) appears in conversation

### Technical Requirements ✅
- [ ] API endpoint `/api/persona/catalog` returns persona data
- [ ] All components have TypeScript types
- [ ] All components have unit tests (>90% coverage)
- [ ] Integration tests cover main flows
- [ ] E2E tests cover user scenarios
- [ ] Error handling for all failure modes
- [ ] Loading states for all async operations
- [ ] Follows existing code patterns and architecture
- [ ] No linting/TypeScript errors
- [ ] Passes all existing tests

### Quality Requirements ✅
- [ ] Follows TDD approach (tests written first)
- [ ] DRY principle followed (reuses existing components)
- [ ] YAGNI principle followed (minimal feature set)
- [ ] Accessible (ARIA labels, keyboard navigation)
- [ ] Mobile responsive
- [ ] Cross-browser compatible
- [ ] Performance optimized (lazy loading, memoization)
- [ ] Error messages are helpful and actionable
- [ ] Consistent with existing UI/UX patterns

### Deployment Requirements ✅
- [ ] All commits have descriptive messages
- [ ] Frequent commits throughout development
- [ ] Feature can be disabled/enabled via feature flag
- [ ] Database migrations (if any) are reversible
- [ ] No breaking changes to existing API
- [ ] Documentation updated
- [ ] Changelog updated

---

## Additional Notes

### Code Style Guidelines
- Follow existing TypeScript strict mode patterns
- Use DaisyUI components with typed wrappers
- Follow existing import patterns (`~/` for internal imports)
- Add `// ABOUTME:` comments to new files
- Use SuperJSON for API serialization
- Follow existing error handling patterns

### Testing Philosophy
- Test behavior, not implementation
- Use factory functions for test data
- Mock external dependencies
- Test error scenarios thoroughly
- Use descriptive test names
- Co-locate test files with source files

### Performance Considerations  
- Lazy load persona catalog data
- Debounce search input
- Memoize filtered persona lists
- Cache API responses appropriately
- Optimize bundle size (check for unused imports)

### Accessibility Requirements
- ARIA labels for all interactive elements
- Keyboard navigation support (tab, enter, escape)
- Screen reader compatibility
- High contrast mode support
- Focus management (trap focus in modal)
- Semantic HTML structure

---

*This plan should be executed in order, with frequent commits and thorough testing at each step. Each task builds on the previous ones, so complete testing of each task before moving to the next is essential.*