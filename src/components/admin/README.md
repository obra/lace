# Instructions Editor

A comprehensive instructions editor for the Lace AI coding assistant that provides an intuitive interface for users to write and edit instructions.

## Features

### Core Functionality
- **Rich text editing** with markdown support
- **Live preview** with side-by-side mode
- **Auto-save** with configurable debouncing
- **Undo/Redo** functionality with history management
- **Search and replace** with regex support
- **Import/Export** functionality
- **Template system** for common instructions
- **Keyboard shortcuts** for power users

### User Experience
- **Intuitive toolbar** with common formatting options
- **Syntax highlighting** for code blocks
- **Responsive design** for different screen sizes
- **Error handling** and validation
- **Loading states** and progress indicators
- **Accessibility** features

### Integration
- **API endpoints** for loading/saving instructions
- **Admin interface** integration
- **Design system** compatibility
- **TypeScript** interfaces and type safety

## Components

### InstructionsEditor
Main editor component with all core functionality.

```tsx
<InstructionsEditor
  title="My Instructions"
  placeholder="Enter instructions..."
  onSave={handleSave}
  onLoad={handleLoad}
  autoSave={true}
  autoSaveDelay={3000}
/>
```

### UserInstructionsEditor
Specialized editor for user instructions (`~/.lace/instructions.md`).

```tsx
<UserInstructionsEditor />
```

### ProjectInstructionsEditor
Specialized editor for project instructions (`CLAUDE.md`).

```tsx
<ProjectInstructionsEditor />
```

### InstructionsManager
Tabbed interface for managing both user and project instructions.

```tsx
<InstructionsManager />
```

## API Endpoints

### User Instructions
- `GET /api/instructions` - Load user instructions
- `POST /api/instructions` - Save user instructions

### Project Instructions
- `GET /api/project-instructions` - Load project instructions
- `POST /api/project-instructions` - Save project instructions

## File Structure

```
src/components/admin/
├── InstructionsEditor.tsx          # Main editor component
├── UserInstructionsEditor.tsx      # User instructions editor
├── ProjectInstructionsEditor.tsx   # Project instructions editor
├── InstructionsManager.tsx         # Tabbed interface
├── EnhancedInstructionsEditor.tsx  # Enhanced with syntax highlighting
├── SearchReplace.tsx               # Search and replace component
├── __tests__/                      # Test files
│   ├── InstructionsEditor.test.tsx
│   └── UserInstructionsEditor.test.tsx
└── README.md                       # This file

src/app/
├── admin/
│   ├── instructions/
│   │   └── page.tsx               # Instructions admin page
│   └── layout.tsx                 # Admin layout
└── api/
    ├── instructions/
    │   └── route.ts               # User instructions API
    └── project-instructions/
        └── route.ts               # Project instructions API
```

## Usage

### Basic Usage

1. Navigate to `/admin/instructions` in the web interface
2. Choose between "User Instructions" and "Project Instructions" tabs
3. Edit instructions using the rich text editor
4. Use the toolbar for common formatting
5. Preview changes in real-time
6. Save manually or rely on auto-save

### Keyboard Shortcuts

- `Ctrl+S` - Save
- `Ctrl+Z` - Undo
- `Ctrl+Shift+Z` - Redo
- `Ctrl+F` - Search
- `Ctrl+B` - Bold
- `Ctrl+I` - Italic
- `Escape` - Close search/modals

### Templates

The editor includes several built-in templates:
- **Basic Instructions** - General instruction format
- **Code Review Guidelines** - Development standards
- **API Documentation** - API reference format
- **Project Setup** - Installation and setup instructions

### Search and Replace

- Open with `Ctrl+F` or the search button
- Supports case-sensitive search
- Whole word matching
- Regular expressions
- Replace current match or all matches

## Configuration

### Environment Variables

Instructions are stored in:
- **User Instructions**: `$LACE_DIR/instructions.md` (default: `~/.lace/instructions.md`)
- **Project Instructions**: `./CLAUDE.md` (project root)

### Auto-save Settings

```tsx
<InstructionsEditor
  autoSave={true}              // Enable auto-save
  autoSaveDelay={3000}         // Save after 3 seconds of inactivity
/>
```

## Development

### Running Tests

```bash
npm test -- src/components/admin
```

### Building

The component is built as part of the main Lace build process:

```bash
npm run build
```

### Linting

```bash
npm run lint
```

## Architecture

### State Management
- Uses React hooks for local state
- Implements undo/redo with history stack
- Debounced auto-save to prevent excessive API calls

### API Integration
- RESTful API endpoints for loading/saving
- Error handling with user-friendly messages
- Loading states and progress indicators

### Accessibility
- Keyboard navigation support
- Screen reader compatibility
- Focus management
- ARIA labels and roles

## Contributing

1. Follow the existing code style
2. Write tests for new features
3. Update documentation
4. Use TypeScript strictly
5. Follow the component patterns established in the codebase

## License

This component is part of the Lace AI coding assistant project.