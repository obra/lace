# Agent Personas

Lace supports multiple agent personas - different system prompts that give agents distinct personalities and capabilities.

## Built-in Personas

- `lace`: Default general-purpose assistant
- `coding-agent`: Specialized for software development with TDD focus
- `helper-agent`: Focused on productivity and task completion

## Using Personas

When creating agents through the task system:

```bash
# Create a coding-focused agent
new:coding-agent:anthropic/claude-3-sonnet

# Create a helpful task-oriented agent  
new:helper-agent:openai/gpt-4

# Default persona
new:lace:anthropic/claude-3-sonnet
```

## NewAgentSpec Format

**Current Format:** `new:persona:provider/model`

Examples:
- `new:lace:anthropic/claude-3-sonnet`
- `new:coding-agent:openai/gpt-4`
- `new:helper-agent:ollama/llama2`

## Custom Personas

Create your own personas in `~/.lace/agent-personas/`:

1. Create a new `.md` file (e.g., `my-persona.md`)
2. Use the template system with `{{include:sections/...}}` 
3. Add persona-specific content and guidelines
4. Use in tasks: `new:my-persona:provider/model`

User personas override built-in ones with the same name.

### Example Custom Persona

```markdown
{{include:sections/agent-personality.md}}

You are a data analysis specialist focused on:
- Statistical analysis and visualization
- Data cleaning and preprocessing  
- Insight generation and reporting

{{include:sections/core-principles.md}}

## Data Analysis Guidelines

- Always validate data quality first
- Use appropriate statistical methods
- Provide clear visualizations
- Explain methodology and assumptions

{{include:sections/tools.md}}
{{context.disclaimer}}
```

## Breaking Changes

### NewAgentSpec Format Change

**Old Format:** `new:provider/model`
**New Format:** `new:persona:provider/model`

#### Migration Required

Update all agent specifications:

```typescript
// Before
const spec = createNewAgentSpec('anthropic', 'claude-3-sonnet');
// Result: 'new:anthropic/claude-3-sonnet'

// After  
const spec = createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet');
// Result: 'new:lace:anthropic/claude-3-sonnet'
```

#### Impact

- All existing task assignments using old format will be treated as regular thread IDs
- Update any hardcoded agent specs in your code
- Update any user-facing documentation showing agent creation syntax

## Architecture

### File Structure

```
packages/core/config/agent-personas/
├── lace.md                      # Default persona
├── coding-agent.md              # Coding specialist
├── helper-agent.md              # Productivity assistant
└── sections/                    # Shared sections
    ├── agent-personality.md
    ├── core-principles.md
    └── ...

~/.lace/agent-personas/          # User overrides
├── my-custom-persona.md         
├── lace.md                      # User override of default
└── sections/                    # User section overrides
    └── agent-personality.md     
```

### Components

- **PersonaRegistry**: Discovers and validates available personas
- **PromptManager**: Generates persona-specific system prompts
- **Agent**: Uses persona for system prompt generation
- **TaskManager**: Spawns agents with correct personas from NewAgentSpec

### Integration Flow

```
NewAgentSpec → parseNewAgentSpec() → PersonaRegistry.validate() →
PromptManager.generateSystemPrompt(persona) → Agent with persona
```