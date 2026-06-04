# Agent Personas

Lace supports multiple agent personas - different system prompts that give
agents distinct personalities and capabilities.

## Built-in Personas

- `lace`: Default general-purpose assistant
- `coding-agent`: Specialized for software development with TDD focus
- `helper-agent`: Focused on productivity and task completion
- `session-summary`: Ultra-minimal prompt for top-of-screen session summaries

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
2. Pull in shared sections with Claude Code-style `@sections/...` references
3. Add persona-specific content and guidelines
4. Use in tasks: `new:my-persona:provider/model`

User personas override built-in ones with the same name.

### Example Custom Persona

```markdown
@sections/agent-personality.md

You are a data analysis specialist focused on:

- Statistical analysis and visualization
- Data cleaning and preprocessing
- Insight generation and reporting

@sections/core-principles.md

## Data Analysis Guidelines

- Always validate data quality first
- Use appropriate statistical methods
- Provide clear visualizations
- Explain methodology and assumptions

@sections/tools.md {{context.disclaimer}}
```

## Breaking Changes

### NewAgentSpec Format Change

**Old Format:** `new:provider/model` **New Format:**
`new:persona:provider/model`

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

- All existing task assignments using old format will be treated as regular
  thread IDs
- Update any hardcoded agent specs in your code
- Update any user-facing documentation showing agent creation syntax

## Plugin-contributed personas

Plugins can contribute personas by pointing the kernel at a directory of `.md`
files. Each file becomes a persona named `<namespace>:<entry>` (where
`namespace` is the plugin's declared namespace and `entry` is the filename
without `.md`). Call `api.personas.addDir(dir)` inside your plugin's
`register()` function:

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function register(api) {
  api.personas.addDir(path.join(__dirname, 'personas'));
}
```

Plugin personas slot between user-disk (higher priority) and bundled personas
(lower priority) in the resolution order: **user-disk > plugin > bundled**.

### Per-persona tools and skills

A persona file at `<dir>/<entry>.md` may have sibling resource directories:

```
personas/
  researcher.md              ← persona 'acme:researcher'
  researcher/
    tools/                   ← exec tools active only when this persona is running
      fetch-papers           ← a +x binary speaking lace-tool-schema/lace-tool-invoke
    skills/                  ← skills injected only for this persona
```

When `acme:researcher` is the active persona, lace additionally loads exec tools
from `personas/researcher/tools/` and skills from `personas/researcher/skills/`.

Per-persona exec tool names are taken directly from the binary's
`lace-tool-schema` descriptor (no namespace prefix is added). These tools can
override a same-named plugin-global or core exec tool, but **cannot** override a
reserved kernel built-in (e.g. `bash`, `file_read`).

See [Writing Plugins](writing-plugins.md) for the full `api.personas.addDir`
walkthrough, and [External Tools](external-tools.md) for the exec tool protocol.

## Architecture

### File Structure

```
packages/agent/config/agent-personas/
├── lace.md                      # Default persona
├── coding-agent.md              # Coding specialist
├── helper-agent.md              # Productivity assistant
└── sections/                    # Shared sections
    ├── agent-personality.md
    ├── core-principles.md
    └── ...

~/.lace/agent-personas/          # User overrides (higher priority)
├── my-custom-persona.md
├── lace.md                      # User override of default
└── sections/                    # User section overrides
    └── agent-personality.md
```

### Components

- **PersonaRegistry**: Discovers and validates available personas (user-disk,
  plugin-contributed, and bundled sources in precedence order)
- **TemplateEngine**: Renders persona body templates, resolving `@path` includes
  and mustache variables
- **Agent**: Uses the active persona for system prompt generation

### Integration Flow

```
persona name → PersonaRegistry.parsePersona(name) → PersonaConfig + body →
TemplateEngine.render(body, context) → system prompt for session
```
