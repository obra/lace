#!/usr/bin/env node

/**
 * Automation script for migrating CONVERT stories to MDX + Playground + Tests
 * Usage: node scripts/migrate-stories.js [story-file-path]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// CONVERT stories from STORYBOOK_TRIAGE.md
const CONVERT_STORIES = [
  'components/ui/TokenUsageDisplay.stories.tsx',
  'components/ui/DirectoryField.stories.tsx',
  'components/ui/FileAttachment.stories.tsx',
  'components/ui/AnimatedButton.stories.tsx',
  'components/ui/VoiceButton.stories.tsx',
  'components/ui/AnimatedCarousel.stories.tsx',
  'components/ui/MessageDisplay.stories.tsx',
  'components/ui/VoiceRecognitionUI.stories.tsx',
  'components/ui/TimestampDisplay.stories.tsx',
  'components/ui/SectionHeader.stories.tsx',
  'components/ui/AccountDropdown.stories.tsx',
  'components/ui/SendButton.stories.tsx',
  'components/ui/SidebarSection.stories.tsx',
  'components/ui/DragDropOverlay.stories.tsx',
  'components/ui/SwipeableCard.stories.tsx',
  'components/ui/NavigationItem.stories.tsx',
  'components/ui/AnimatedModal.stories.tsx',
  'components/ui/FileAttachButton.stories.tsx',
  'components/ui/GlassCard.stories.tsx',
  'components/ui/ChatTextarea.stories.tsx',
  'components/ui/NavigationButton.stories.tsx',
  'components/ui/ChatInputComposer.stories.tsx',
  'components/ui/AdvancedSettingsCollapse.stories.tsx',
  'components/ui/ThemeSelector.stories.tsx',
  'components/ui/ExpandableHeader.stories.tsx',
  'components/ui/InfoSection.stories.tsx',
  'components/ui/VaporBackground.stories.tsx',
  'components/ui/MessageText.stories.tsx',
  'components/ui/InfoIconButton.stories.tsx',
  'components/ui/MessageHeader.stories.tsx',
  'components/ui/OnboardingHero.stories.tsx',
  'components/ui/StreamingIndicator.stories.tsx',
  'components/ui/AccentSelect.stories.tsx',
  'components/ui/MessageBubble.stories.tsx',
  'components/ui/AccentInput.stories.tsx',
  'components/ui/OnboardingActions.stories.tsx',
  'components/settings/panels/UISettingsPanel.stories.tsx',
  'components/chat/EnhancedChatInput.stories.tsx',
  'components/layout/__stories__/MobileSidebar.stories.tsx',
  'components/layout/__stories__/Sidebar.stories.tsx',
  'components/layout/MobileSidebar.stories.tsx',
  'components/layout/Sidebar.stories.tsx',
  'components/modals/TaskBoardModal.stories.tsx',
  'components/feedback/FeedbackMiniDisplay.stories.tsx',
  'components/feedback/PerformancePanel.stories.tsx',
  'components/feedback/FeedbackInsightCard.stories.tsx',
  'components/feedback/FeedbackDisplay.stories.tsx',
  'components/feedback/FeedbackEventCard.stories.tsx',
  'components/feedback/PredictivePanel.stories.tsx',
  'components/files/CarouselCodeChanges.stories.tsx',
  'components/files/FileDiffViewer.stories.tsx',
  'components/timeline/tool/file-write.stories.tsx',
  'components/organisms/GoogleDocChatMessage.stories.tsx',
];

/**
 * Extract component info from story file path
 */
function parseStoryPath(storyPath) {
  const fullPath = path.resolve(rootDir, storyPath);
  const dir = path.dirname(fullPath);
  const fileName = path.basename(storyPath, '.stories.tsx');
  const componentPath = path.join(dir, `${fileName}.tsx`);
  const importPath = `@/${storyPath.replace('.stories.tsx', '').replace(/^packages\/web\//, '')}`;
  
  return {
    storyPath: fullPath,
    componentPath,
    componentName: fileName,
    importPath,
    dir,
  };
}

/**
 * Read and parse story file to extract component info
 */
function parseStoryFile(storyFilePath) {
  if (!fs.existsSync(storyFilePath)) {
    console.log(`⚠️  Story file not found: ${storyFilePath}`);
    return null;
  }

  const content = fs.readFileSync(storyFilePath, 'utf8');
  
  // Extract component import
  const importMatch = content.match(/import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/);
  const componentName = importMatch?.[1];
  
  // Extract description from meta
  const descriptionMatch = content.match(/description:\s*\{\s*component:\s*`([^`]*)`/s);
  const description = descriptionMatch?.[1]?.trim() || '';
  
  // Extract stories (exports)
  const storyMatches = content.match(/export\s+const\s+(\w+):\s*Story/g) || [];
  const stories = storyMatches.map(match => match.match(/export\s+const\s+(\w+):/)[1]);
  
  // Extract render functions for complex stories
  const renderMatches = [...content.matchAll(/export\s+const\s+(\w+):\s*Story\s*=\s*\{[^}]*render:\s*\(\)\s*=>\s*\(([\s\S]*?)\)\s*,/g)];
  
  return {
    componentName,
    description,
    stories,
    renders: renderMatches.map(match => ({ name: match[1], jsx: match[2] })),
    content
  };
}

/**
 * Generate MDX documentation
 */
function generateMDX(componentName, storyInfo, componentPath) {
  const componentExists = fs.existsSync(componentPath);
  let propsTable = '';
  
  if (componentExists) {
    try {
      const componentContent = fs.readFileSync(componentPath, 'utf8');
      const interfaceMatch = componentContent.match(/interface\s+\w+Props\s*\{([^}]+)\}/s);
      if (interfaceMatch) {
        const props = interfaceMatch[1];
        const propLines = props.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//'))
          .map(line => {
            const [prop, type] = line.split(':').map(s => s.trim().replace(/[;,]/g, ''));
            const optional = prop.includes('?');
            const propName = prop.replace('?', '');
            return `| \`${propName}\` | \`${type}\` | ${optional ? 'Optional' : 'Required'} | - |`;
          });
        
        if (propLines.length > 0) {
          propsTable = `
## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
${propLines.join('\n')}`;
        }
      }
    } catch (e) {
      console.log(`⚠️  Could not parse props for ${componentName}`);
    }
  }

  const description = storyInfo?.description || `${componentName} component`;
  const cleanDescription = description
    .replace(/^##?\s*\w+\s*/, '') // Remove title
    .replace(/\*\*[^*]+\*\*:\s*[^\n]+/g, '') // Remove classification lines
    .split('\n')
    .filter(line => line.trim() && !line.includes('**'))
    .slice(0, 3)
    .join('\n')
    .trim();

  return `# ${componentName}

${cleanDescription || `${componentName} component for the application.`}

## Usage

\`\`\`tsx
import ${componentName} from '@/components/ui/${componentName}';

// Basic usage
<${componentName} />
\`\`\`
${propsTable}

## Examples

See the [Playground](/play) for interactive examples.

## When to Use

- Component-specific use cases
- Integration scenarios
- UI patterns

## Accessibility

- Keyboard navigation support
- Screen reader compatibility
- ARIA labels where appropriate
`;
}

/**
 * Generate test file
 */
function generateTest(componentName, importPath) {
  return `import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ${componentName} from '../${componentName}';

describe('${componentName}', () => {
  it('renders without crashing', () => {
    render(<${componentName} />);
    // Add more specific tests based on component functionality
  });

  it('applies custom className when provided', () => {
    const { container } = render(<${componentName} className="custom-class" />);
    const element = container.firstChild;
    expect(element).toHaveClass('custom-class');
  });

  // TODO: Add more component-specific tests
  // - Test props
  // - Test interactions
  // - Test edge cases
});
`;
}

/**
 * Generate playground section
 */
function generatePlaygroundSection(componentName, storyInfo, importPath) {
  const stories = storyInfo?.stories || ['Default'];
  const renders = storyInfo?.renders || [];
  
  let examples = '';
  
  if (renders.length > 0) {
    // Use render functions from stories
    examples = renders.map(render => `
            <div>
              <h4 className="text-sm font-medium text-gray-600 mb-2">${render.name}</h4>
              <div className="p-4 border border-gray-200 rounded">
                ${render.jsx.trim()}
              </div>
            </div>`).join('\n');
  } else {
    // Generate basic examples
    examples = `
            <div>
              <h4 className="text-sm font-medium text-gray-600 mb-2">Default</h4>
              <div className="p-4 border border-gray-200 rounded">
                <${componentName} />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-600 mb-2">With Custom Props</h4>
              <div className="p-4 border border-gray-200 rounded">
                <${componentName} className="custom-class" />
              </div>
            </div>`;
  }

  return `        {/* ${componentName} Examples */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">${componentName}</h2>
          
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">${examples}
            </div>
          </div>
        </section>
`;
}

/**
 * Update playground page with new component
 */
function updatePlaygroundPage(componentName, storyInfo, importPath) {
  const playgroundPath = path.join(rootDir, 'app/play/page.tsx');
  
  if (!fs.existsSync(playgroundPath)) {
    console.log('⚠️  Playground page not found');
    return;
  }

  let content = fs.readFileSync(playgroundPath, 'utf8');
  
  // Add import
  const importStatement = `import ${componentName} from '${importPath}';`;
  if (!content.includes(importStatement)) {
    const importSection = content.split('\n').findIndex(line => line.startsWith('import'));
    const lines = content.split('\n');
    lines.splice(importSection + 1, 0, importStatement);
    content = lines.join('\n');
  }
  
  // Add playground section
  const playgroundSection = generatePlaygroundSection(componentName, storyInfo, importPath);
  const insertPoint = content.indexOf('        {/* Getting Started Section */}');
  
  if (insertPoint !== -1) {
    content = content.slice(0, insertPoint) + playgroundSection + '\n' + content.slice(insertPoint);
  }
  
  fs.writeFileSync(playgroundPath, content);
  console.log(`✅ Updated playground with ${componentName}`);
}

/**
 * Move story file to parked directory
 */
function parkStoryFile(storyPath) {
  const parkedDir = path.join(rootDir, 'stories_parked');
  const fileName = path.basename(storyPath);
  const parkedPath = path.join(parkedDir, fileName);
  
  if (!fs.existsSync(parkedDir)) {
    fs.mkdirSync(parkedDir, { recursive: true });
  }
  
  try {
    // Add header comment
    const content = fs.readFileSync(storyPath, 'utf8');
    const parkedContent = `/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */\n${content}`;
    
    fs.writeFileSync(parkedPath, parkedContent);
    fs.unlinkSync(storyPath);
    console.log(`✅ Moved ${fileName} to stories_parked/`);
  } catch (error) {
    console.log(`⚠️  Error parking ${fileName}: ${error.message}`);
  }
}

/**
 * Add React import to component if missing
 */
function ensureReactImport(componentPath) {
  if (!fs.existsSync(componentPath)) {
    return;
  }
  
  let content = fs.readFileSync(componentPath, 'utf8');
  
  // Check if React is already imported
  if (content.includes("import React from 'react'") || content.includes('import * as React')) {
    return;
  }
  
  // Add React import at the top
  const lines = content.split('\n');
  const firstImportIndex = lines.findIndex(line => line.startsWith('import '));
  
  if (firstImportIndex !== -1) {
    lines.splice(firstImportIndex, 0, "import React from 'react';", '');
  } else {
    lines.unshift("import React from 'react';", '');
  }
  
  content = lines.join('\n');
  fs.writeFileSync(componentPath, content);
  console.log(`✅ Added React import to component`);
}

/**
 * Migrate a single story
 */
function migrateStory(storyPath) {
  console.log(`🔄 Migrating ${storyPath}...`);
  
  const info = parseStoryPath(storyPath);
  const storyInfo = parseStoryFile(info.storyPath);
  
  if (!storyInfo) {
    console.log(`❌ Could not parse story file: ${storyPath}`);
    return false;
  }
  
  // Ensure React import in component
  ensureReactImport(info.componentPath);
  
  // Generate MDX
  const mdxPath = path.join(info.dir, `${info.componentName}.mdx`);
  const mdxContent = generateMDX(info.componentName, storyInfo, info.componentPath);
  fs.writeFileSync(mdxPath, mdxContent);
  console.log(`✅ Created ${info.componentName}.mdx`);
  
  // Generate test
  const testDir = path.join(info.dir, '__tests__');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testPath = path.join(testDir, `${info.componentName}.test.tsx`);
  if (!fs.existsSync(testPath)) {
    const testContent = generateTest(info.componentName, info.importPath);
    fs.writeFileSync(testPath, testContent);
    console.log(`✅ Created ${info.componentName}.test.tsx`);
  } else {
    console.log(`⚠️  Test file already exists: ${info.componentName}.test.tsx`);
  }
  
  // Update playground
  updatePlaygroundPage(info.componentName, storyInfo, info.importPath);
  
  // Park story file
  parkStoryFile(info.storyPath);
  
  console.log(`✅ Successfully migrated ${info.componentName}\n`);
  return true;
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Migrate specific story
    const storyPath = args[0];
    migrateStory(storyPath);
  } else {
    // Migrate all CONVERT stories
    console.log(`🚀 Starting migration of ${CONVERT_STORIES.length} CONVERT stories...\n`);
    
    let successful = 0;
    let failed = 0;
    
    for (const storyPath of CONVERT_STORIES) {
      if (migrateStory(storyPath)) {
        successful++;
      } else {
        failed++;
      }
    }
    
    console.log(`\n🎉 Migration complete!`);
    console.log(`✅ Successfully migrated: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`\nNext steps:`);
    console.log(`1. Run: npm test`);
    console.log(`2. Visit: /play to see migrated components`);
    console.log(`3. Review and update generated tests`);
  }
}

main();