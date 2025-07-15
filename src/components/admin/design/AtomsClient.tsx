'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch,
  faTerminal,
  faTasks,
  faUser,
  faRobot,
  faCog,
  faPlus,
  faStop,
  faCheck,
} from '~/lib/fontawesome';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  HomeIcon,
  UserIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

// Import our actual atomic components to showcase them
import {
  IconButton,
  StatusDot,
  Badge,
  Avatar,
  LoadingDots,
  StreamingIndicator,
  ChatTextarea,
  VoiceButton,
  SendButton,
  FileAttachButton,
  SectionHeader,
  MessageHeader,
  ChatInputComposer,
  MessageText,
  AgentBadge,
  TimestampDisplay,
  NavigationButton,
  MessageDisplay,
  SidebarSection,
} from '~/components/ui';

interface AtomsClientProps {
  designTokens: any;
  buttonVariants: any[];
  buttonSizes: any[];
  inputTypes: any[];
  fontAwesomeIcons: any[];
  heroIcons: any[];
  atomicRecommendations: any[];
}

export function AtomsClient({
  designTokens,
  buttonVariants,
  buttonSizes,
  inputTypes,
  fontAwesomeIcons,
  heroIcons,
  atomicRecommendations,
}: AtomsClientProps) {
  const [activeTab, setActiveTab] = useState('components');

  return (
    <>
      {/* Navigation Tabs */}
      <div className="bg-base-100 rounded-lg border border-base-300">
        <div className="flex border-b border-base-300">
          {[
            { id: 'components', label: 'Current Atoms', desc: 'Our existing atomic components' },
            { id: 'needed', label: 'Recommended Breakdowns', desc: 'Components to atomize' },
            { id: 'tokens', label: 'Design Tokens', desc: 'Colors, spacing, typography' },
            { id: 'buttons', label: 'Buttons', desc: 'Interactive elements' },
            { id: 'inputs', label: 'Form Controls', desc: 'Input fields, labels' },
            { id: 'icons', label: 'Icons', desc: 'FontAwesome + Heroicons' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 p-4 text-left transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'hover:bg-base-200'
              }`}
            >
              <div className="font-medium">{tab.label}</div>
              <div className="text-xs text-base-content/60">{tab.desc}</div>
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Current Atomic Components */}
          {activeTab === 'components' && <ComponentsTab />}

          {/* Recommended Atomic Breakdowns */}
          {activeTab === 'needed' && (
            <RecommendedTab atomicRecommendations={atomicRecommendations} />
          )}

          {/* Design Tokens */}
          {activeTab === 'tokens' && <TokensTab designTokens={designTokens} />}

          {/* Buttons */}
          {activeTab === 'buttons' && (
            <ButtonsTab buttonVariants={buttonVariants} buttonSizes={buttonSizes} />
          )}

          {/* Form Controls */}
          {activeTab === 'inputs' && <InputsTab inputTypes={inputTypes} />}

          {/* Icons */}
          {activeTab === 'icons' && (
            <IconsTab fontAwesomeIcons={fontAwesomeIcons} heroIcons={heroIcons} />
          )}
        </div>
      </div>
    </>
  );
}

function ComponentsTab() {
  return (
    <div className="space-y-8">
      {/* IconButton Showcase */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">IconButton Atom</h3>
        <p className="text-base-content/70 mb-4">
          Theme-aware icon buttons with consistent sizing, variants, and states.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-base-content mb-3">Variants</h4>
            <div className="flex flex-wrap gap-3 p-4 border border-base-300 rounded">
              <IconButton icon={faSearch} variant="primary" />
              <IconButton icon={faCog} variant="secondary" />
              <IconButton icon={faPlus} variant="accent" />
              <IconButton icon={faCheck} variant="ghost" />
              <IconButton icon={faTerminal} variant="outline" />
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-base-content mb-3">Sizes</h4>
            <div className="flex items-end gap-3 p-4 border border-base-300 rounded">
              <IconButton icon={faUser} size="xs" />
              <IconButton icon={faUser} size="sm" />
              <IconButton icon={faUser} size="md" />
              <IconButton icon={faUser} size="lg" />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold text-base-content mb-3">With Badges & States</h4>
          <div className="flex flex-wrap gap-4 p-4 border border-base-300 rounded">
            <IconButton icon={faTasks} badge="3" />
            <IconButton icon={faRobot} badge="!" />
            <IconButton icon={faStop} loading />
            <IconButton icon={faPlus} disabled />
          </div>
        </div>
      </div>

      {/* StatusDot Showcase */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">StatusDot Atom</h3>
        <p className="text-base-content/70 mb-4">
          Semantic status indicators using DaisyUI theme colors.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-base-content mb-3">Status Types</h4>
            <div className="space-y-3 p-4 border border-base-300 rounded">
              <div className="flex items-center gap-3">
                <StatusDot status="online" />
                <span className="text-sm">Online - Active and available</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status="busy" />
                <span className="text-sm">Busy - Currently processing</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status="away" />
                <span className="text-sm">Away - Temporarily unavailable</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status="offline" />
                <span className="text-sm">Offline - Not connected</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status="error" />
                <span className="text-sm">Error - Something went wrong</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status="success" />
                <span className="text-sm">Success - Task completed</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-base-content mb-3">Sizes</h4>
            <div className="flex items-center gap-4 p-4 border border-base-300 rounded">
              <div className="text-center">
                <StatusDot status="online" size="xs" />
                <div className="text-xs text-base-content/60 mt-1">xs</div>
              </div>
              <div className="text-center">
                <StatusDot status="online" size="sm" />
                <div className="text-xs text-base-content/60 mt-1">sm</div>
              </div>
              <div className="text-center">
                <StatusDot status="online" size="md" />
                <div className="text-xs text-base-content/60 mt-1">md</div>
              </div>
              <div className="text-center">
                <StatusDot status="online" size="lg" />
                <div className="text-xs text-base-content/60 mt-1">lg</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Badge Showcase */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Badge Atom</h3>
        <p className="text-base-content/70 mb-4">
          Consistent labels and tags with proper semantic coloring.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-base-content mb-3">Variants</h4>
            <div className="flex flex-wrap gap-2 p-4 border border-base-300 rounded">
              <Badge variant="primary">Primary</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="accent">Accent</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="error">Error</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-base-content mb-3">Sizes</h4>
            <div className="flex items-center gap-3 p-4 border border-base-300 rounded">
              <Badge variant="primary" size="xs">
                xs
              </Badge>
              <Badge variant="primary" size="sm">
                sm
              </Badge>
              <Badge variant="primary" size="md">
                md
              </Badge>
              <Badge variant="primary" size="lg">
                lg
              </Badge>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold text-base-content mb-3">Usage Examples</h4>
          <div className="space-y-2 p-4 border border-base-300 rounded">
            <div className="flex items-center gap-2">
              <span className="text-sm">Agent Status:</span>
              <Badge variant="success" size="xs">
                Claude
              </Badge>
              <Badge variant="warning" size="xs">
                GPT-4
              </Badge>
              <Badge variant="error" size="xs">
                Offline
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Task Count:</span>
              <Badge variant="primary">12</Badge>
              <span className="text-sm">New Messages:</span>
              <Badge variant="accent">3</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Avatar Showcase */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Avatar Atom</h3>
        <p className="text-base-content/70 mb-4">
          Square-ish avatars (rounded-md) for consistent user representation.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-base-content mb-3">Sizes</h4>
            <div className="flex items-end gap-4 p-4 border border-base-300 rounded">
              <div className="text-center">
                <Avatar role="user" size="sm" />
                <div className="text-xs text-base-content/60 mt-1">sm</div>
              </div>
              <div className="text-center">
                <Avatar role="user" size="md" />
                <div className="text-xs text-base-content/60 mt-1">md</div>
              </div>
              <div className="text-center">
                <Avatar role="user" size="lg" />
                <div className="text-xs text-base-content/60 mt-1">lg</div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-base-content mb-3">Roles</h4>
            <div className="flex flex-wrap gap-3 p-4 border border-base-300 rounded">
              <Avatar role="assistant" />
              <Avatar role="user" />
              <Avatar role="assistant" />
              <Avatar role="user" />
            </div>
          </div>
        </div>
      </div>

      {/* Loading Components */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Loading Atoms</h3>
        <p className="text-base-content/70 mb-4">
          Consistent loading indicators for different contexts.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-base-content mb-3">Loading Dots</h4>
            <div className="flex items-center gap-4 p-4 border border-base-300 rounded">
              <LoadingDots />
              <span className="text-sm text-base-content/60">Standard loading animation</span>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-base-content mb-3">Streaming Indicator</h4>
            <div className="flex items-center gap-4 p-4 border border-base-300 rounded">
              <StreamingIndicator isVisible={true} />
              <span className="text-sm text-base-content/60">Real-time streaming feedback</span>
            </div>
          </div>
        </div>
      </div>

      {/* New Input Atoms */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Input Control Atoms</h3>
        <p className="text-base-content/70 mb-4">
          Reusable input components extracted from complex chat interfaces.
        </p>

        <div className="space-y-6">
          {/* ChatTextarea */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">ChatTextarea Atom</h4>
            <div className="space-y-3">
              <ChatTextarea
                value="Auto-resizing textarea with keyboard handling..."
                onChange={() => {}}
                placeholder="Type a message..."
                className="max-w-md"
              />
              <div className="text-sm text-base-content/60">
                Extracted from EnhancedChatInput • Auto-resize • Keyboard shortcuts
              </div>
            </div>
          </div>

          {/* Voice and Send Buttons */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">Action Button Atoms</h4>
            <div className="flex flex-wrap gap-4 p-4 border border-base-300 rounded">
              <div className="space-y-2">
                <VoiceButton isListening={false} onToggle={() => {}} />
                <div className="text-xs text-center text-base-content/60">Voice</div>
              </div>
              <div className="space-y-2">
                <VoiceButton isListening={true} onToggle={() => {}} />
                <div className="text-xs text-center text-base-content/60">Listening</div>
              </div>
              <div className="space-y-2">
                <SendButton hasContent={true} onSubmit={() => {}} />
                <div className="text-xs text-center text-base-content/60">Send</div>
              </div>
              <div className="space-y-2">
                <SendButton isStreaming={true} onStop={() => {}} />
                <div className="text-xs text-center text-base-content/60">Stop</div>
              </div>
              <div className="space-y-2">
                <FileAttachButton onFilesSelected={() => {}} />
                <div className="text-xs text-center text-base-content/60">Attach</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Layout Atoms */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Layout & Header Atoms</h3>
        <p className="text-base-content/70 mb-4">
          Structural components for consistent layouts and message headers.
        </p>

        <div className="space-y-6">
          {/* SectionHeader */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">SectionHeader Atom</h4>
            <div className="space-y-3 max-w-md">
              <SectionHeader
                title="Conversations"
                isExpanded={true}
                onToggle={() => {}}
                badge={{ text: '5', variant: 'teal' }}
              />
              <SectionHeader
                title="Collapsed Section"
                isExpanded={false}
                onToggle={() => {}}
              />
              <div className="text-sm text-base-content/60">
                Extracted from Sidebar • Collapsible • Badge support
              </div>
            </div>
          </div>

          {/* MessageHeader */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">MessageHeader Molecule</h4>
            <div className="space-y-4 p-4 border border-base-300 rounded">
              <MessageHeader name="You" timestamp={new Date()} role="user" />
              <MessageHeader
                name="Claude"
                timestamp={new Date()}
                role="assistant"
                badge={{ text: 'Claude', variant: 'primary' }}
              />
              <div className="text-sm text-base-content/60">
                Extracted from TimelineMessage • Avatar • Timestamp • Badge
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Molecule Example */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">
          🧬 Molecule Example: ChatInputComposer
        </h3>
        <p className="text-base-content/70 mb-4">
          Complete chat input built from atomic components - reduced EnhancedChatInput from 319 →
          60 lines!
        </p>

        <div className="border border-base-300 rounded-lg p-4 bg-gradient-to-br from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20">
          <ChatInputComposer
            value=""
            onChange={() => {}}
            onSubmit={() => alert('Message sent! (Demo mode)')}
            placeholder="Try the atomic chat input..."
            showVoiceButton={true}
            showFileAttachment={true}
            onStartVoice={() => alert('Voice started! (Demo mode)')}
            onFilesAttached={() => alert('Files attached! (Demo mode)')}
          />
          <div className="mt-3 text-sm text-base-content/60 text-center">
            ⚛️ Built from: ChatTextarea + VoiceButton + SendButton + FileAttachButton atoms
          </div>
        </div>
      </div>

      {/* New Atoms from TimelineMessage */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Message & Navigation Atoms</h3>
        <p className="text-base-content/70 mb-4">
          Additional atoms extracted from TimelineMessage and Sidebar components.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Message Atoms */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">Message Content Atoms</h4>
            <div className="space-y-4 p-4 border border-base-300 rounded">
              <div>
                <div className="text-xs text-base-content/60 mb-2">MessageText</div>
                <MessageText content="This is **formatted** text with `inline code` and formatting." />
              </div>
              <div>
                <div className="text-xs text-base-content/60 mb-2">AgentBadge</div>
                <div className="flex gap-2">
                  <AgentBadge agent="Claude" />
                  <AgentBadge agent="GPT-4" />
                  <AgentBadge agent="Gemini" />
                </div>
              </div>
              <div>
                <div className="text-xs text-base-content/60 mb-2">TimestampDisplay</div>
                <div className="flex gap-3">
                  <TimestampDisplay timestamp={new Date()} format="time" />
                  <TimestampDisplay timestamp={new Date()} format="relative" />
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Atoms */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">NavigationButton Atom</h4>
            <div className="space-y-4 p-4 border border-base-300 rounded">
              <div>
                <div className="text-xs text-base-content/60 mb-2">Sidebar variant</div>
                <div className="flex gap-2">
                  <NavigationButton icon={faSearch} onClick={() => {}} title="Search" />
                  <NavigationButton
                    icon={faTerminal}
                    onClick={() => {}}
                    title="Terminal"
                    isActive
                  />
                  <NavigationButton icon={faTasks} onClick={() => {}} title="Tasks" />
                </div>
              </div>
              <div>
                <div className="text-xs text-base-content/60 mb-2">Toolbar variant</div>
                <div className="flex gap-2">
                  <NavigationButton
                    icon={faSearch}
                    onClick={() => {}}
                    title="Search"
                    variant="toolbar"
                  />
                  <NavigationButton
                    icon={faTerminal}
                    onClick={() => {}}
                    title="Terminal"
                    variant="toolbar"
                    isActive
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Molecules */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">🧬 New Molecules</h3>
        <p className="text-base-content/70 mb-4">
          Advanced molecular components built from our atomic foundation.
        </p>

        <div className="space-y-6">
          {/* MessageDisplay */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">MessageDisplay Molecule</h4>
            <div className="space-y-4 p-4 border border-base-300 rounded bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
              <MessageDisplay
                type="human"
                content="This is a complete message display using atomic components!"
                timestamp={new Date()}
              />
              <MessageDisplay
                type="ai"
                content="And here's an AI response with **formatting** and `code` support."
                timestamp={new Date()}
                agent="Claude"
              />
              <div className="text-sm text-base-content/60 text-center mt-3">
                ⚛️ Built from: MessageHeader + MessageText + Avatar + AgentBadge + TimestampDisplay
              </div>
            </div>
          </div>

          {/* SidebarSection */}
          <div>
            <h4 className="font-semibold text-base-content mb-3">SidebarSection Molecule</h4>
            <div className="max-w-md p-4 border border-base-300 rounded bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <SidebarSection
                title="Tools"
                isExpanded={true}
                onToggle={() => {}}
                badge={{ text: '3', variant: 'teal' }}
              >
                <NavigationButton icon={faSearch} onClick={() => {}} title="Search" />
                <NavigationButton icon={faTerminal} onClick={() => {}} title="Terminal" />
                <NavigationButton icon={faTasks} onClick={() => {}} title="Tasks" />
              </SidebarSection>
              <div className="text-sm text-base-content/60 text-center mt-3">
                ⚛️ Built from: SectionHeader + NavigationButton atoms
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendedTab({ atomicRecommendations }: { atomicRecommendations: any[] }) {
  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-br from-teal-50 to-teal-100/50 rounded-lg border border-teal-200 p-6">
        <h3 className="text-xl font-bold text-teal-800 mb-4">🔬 Component Analysis Results</h3>
        <p className="text-teal-700 mb-4">
          Based on our codebase analysis, we've identified several large components that should be
          broken down into atomic units for better reusability and maintainability.
        </p>
        <div className="bg-teal-600 text-white rounded p-3 text-sm">
          <strong>Priority:</strong> Focus on EnhancedChatInput (319 lines) and TimelineMessage
          (348 lines) first for maximum impact.
        </div>
      </div>

      {atomicRecommendations.map((category, index) => (
        <div key={index}>
          <h3 className="text-xl font-bold text-base-content mb-4">{category.category}</h3>
          <p className="text-base-content/70 mb-6">{category.description}</p>

          <div className="grid md:grid-cols-2 gap-4">
            {category.atoms.map((atom: any, atomIndex: number) => (
              <div
                key={atomIndex}
                className="border border-base-300 rounded-lg p-4 hover:border-primary transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-semibold text-base-content">{atom.name}</h4>
                  <Badge variant="outline" size="xs">
                    {atom.source}
                  </Badge>
                </div>
                <p className="text-sm text-base-content/70 mb-3">{atom.usage}</p>
                <div className="text-xs text-base-content/60">
                  Extract from:{' '}
                  <code className="bg-base-200 px-1 rounded">{atom.source}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Implementation Priority */}
      <div className="bg-orange-50 rounded-lg border border-orange-200 p-6">
        <h3 className="text-lg font-bold text-orange-800 mb-4">🚀 Implementation Roadmap</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <h4 className="font-semibold text-orange-700 mb-2">Phase 1: Quick Wins</h4>
            <div className="space-y-1 text-sm text-orange-700">
              <div>• Extract button atoms from EnhancedChatInput</div>
              <div>• Create MessageHeader molecule</div>
              <div>• Extract SectionHeader from Sidebar</div>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-orange-700 mb-2">Phase 2: Major Refactor</h4>
            <div className="space-y-1 text-sm text-orange-700">
              <div>• Complete TimelineMessage breakdown</div>
              <div>• Rebuild Sidebar with molecules</div>
              <div>• Refactor EnhancedChatInput</div>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-orange-700 mb-2">Phase 3: Polish</h4>
            <div className="space-y-1 text-sm text-orange-700">
              <div>• TaskBoardModal modularization</div>
              <div>• VoiceUI atomic breakdown</div>
              <div>• Consistent animation patterns</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokensTab({ designTokens }: { designTokens: any }) {
  return (
    <div className="space-y-8">
      {/* Colors */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Color System</h3>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-base-content mb-3">Semantic Colors</h4>
            <div className="space-y-2">
              {designTokens.colors.semantic.map((color: any) => (
                <div key={color.name} className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 ${color.class} rounded border border-base-300`}
                  ></div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{color.name}</div>
                    <div className="text-xs text-base-content/60">{color.desc}</div>
                  </div>
                  <code className="text-xs bg-base-200 px-2 py-1 rounded">{color.class}</code>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-base-content mb-3">Feedback Colors</h4>
            <div className="space-y-2">
              {designTokens.colors.feedback.map((color: any) => (
                <div key={color.name} className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 ${color.class} rounded border border-base-300`}
                  ></div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{color.name}</div>
                    <div className="text-xs text-base-content/60">{color.desc}</div>
                  </div>
                  <code className="text-xs bg-base-200 px-2 py-1 rounded">{color.class}</code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Typography */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Typography Scale</h3>
        <div className="space-y-3">
          {designTokens.typography.map((type: any) => (
            <div
              key={type.name}
              className="flex items-center gap-4 p-3 border border-base-300 rounded"
            >
              <div className="w-12 text-xs text-base-content/60">{type.name}</div>
              <div className={`flex-1 ${type.class} font-medium`}>
                The quick brown fox jumps over the lazy dog
              </div>
              <div className="text-xs text-base-content/60">{type.size}</div>
              <div className="text-xs text-base-content/60 max-w-32">{type.usage}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Spacing */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Spacing Scale</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {designTokens.spacing.map((space: any) => (
            <div key={space.name} className="border border-base-300 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{space.name}</span>
                <code className="text-xs bg-base-200 px-2 py-1 rounded">{space.value}</code>
              </div>
              <div className="bg-base-200 rounded">
                <div
                  className={`bg-primary/20 ${space.class} border-2 border-primary rounded`}
                >
                  <div className="w-4 h-4 bg-primary rounded"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Border Radius */}
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Border Radius</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {designTokens.borderRadius.map((radius: any) => (
            <div key={radius.name} className="text-center">
              <div
                className={`w-16 h-16 bg-primary/20 border-2 border-primary ${radius.class} mx-auto mb-2`}
              ></div>
              <div className="font-medium text-sm">{radius.name}</div>
              <div className="text-xs text-base-content/60">{radius.value}</div>
              <div className="text-xs text-base-content/60 mt-1">{radius.usage}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ButtonsTab({
  buttonVariants,
  buttonSizes,
}: {
  buttonVariants: any[];
  buttonSizes: any[];
}) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Button Variants</h3>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buttonVariants.map((variant) => (
            <div
              key={variant.name}
              className="border border-base-300 rounded p-4 text-center"
            >
              <button className={`btn ${variant.class} mb-3`}>{variant.name}</button>
              <div className="text-sm font-medium">{variant.name}</div>
              <div className="text-xs text-base-content/60">{variant.usage}</div>
              <code className="text-xs bg-base-200 px-2 py-1 rounded block mt-2">
                btn {variant.class}
              </code>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Button Sizes</h3>
        <div className="flex flex-wrap items-end gap-4 p-4 border border-base-300 rounded">
          {buttonSizes.map((size) => (
            <div key={size.name} className="text-center">
              <button className={`btn btn-primary ${size.class} mb-2`}>{size.name}</button>
              <div className="text-xs text-base-content/60">{size.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Button States</h3>
        <div className="grid md:grid-cols-4 gap-4">
          <div className="border border-base-300 rounded p-4 text-center">
            <button className="btn btn-primary mb-2">Normal</button>
            <div className="text-xs text-base-content/60">Default state</div>
          </div>
          <div className="border border-base-300 rounded p-4 text-center">
            <button className="btn btn-primary btn-disabled mb-2">Disabled</button>
            <div className="text-xs text-base-content/60">Inactive state</div>
          </div>
          <div className="border border-base-300 rounded p-4 text-center">
            <button className="btn btn-primary loading mb-2">Loading</button>
            <div className="text-xs text-base-content/60">Processing state</div>
          </div>
          <div className="border border-base-300 rounded p-4 text-center">
            <motion.button
              className="btn btn-primary mb-2"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Animated
            </motion.button>
            <div className="text-xs text-base-content/60">With motion</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InputsTab({ inputTypes }: { inputTypes: any[] }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Input Types</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {inputTypes.map((input) => (
            <div key={input.name} className="space-y-2">
              <label className="label">
                <span className="label-text font-medium">{input.name} Input</span>
              </label>
              <input
                type={input.type}
                placeholder={input.placeholder}
                className="input input-bordered w-full"
              />
              <code className="text-xs text-base-content/60">type="{input.type}"</code>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Input Variants</h3>
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">
                <span className="label-text">Default</span>
              </label>
              <input
                type="text"
                placeholder="Default input"
                className="input input-bordered w-full"
              />
            </div>
            <div>
              <label className="label">
                <span className="label-text">Success</span>
              </label>
              <input
                type="text"
                placeholder="Valid input"
                className="input input-bordered input-success w-full"
              />
            </div>
            <div>
              <label className="label">
                <span className="label-text">Error</span>
              </label>
              <input
                type="text"
                placeholder="Invalid input"
                className="input input-bordered input-error w-full"
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Other Form Elements</h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="label">
                <span className="label-text">Textarea</span>
              </label>
              <textarea
                className="textarea textarea-bordered w-full h-24"
                placeholder="Multiline text input..."
              ></textarea>
            </div>
            <div>
              <label className="label">
                <span className="label-text">Select</span>
              </label>
              <select className="select select-bordered w-full" defaultValue="">
                <option disabled value="">
                  Choose option
                </option>
                <option value="option1">Option 1</option>
                <option value="option2">Option 2</option>
                <option value="option3">Option 3</option>
              </select>
            </div>
          </div>
          <div className="space-y-4">
            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">Checkbox</span>
                <input type="checkbox" className="checkbox checkbox-primary" />
              </label>
            </div>
            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">Radio Button</span>
                <input type="radio" name="radio-demo" className="radio radio-primary" />
              </label>
            </div>
            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">Toggle</span>
                <input type="checkbox" className="toggle toggle-primary" />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconsTab({
  fontAwesomeIcons,
  heroIcons,
}: {
  fontAwesomeIcons: any[];
  heroIcons: any[];
}) {
  // Helper function to get FontAwesome icon by name
  const getFontAwesomeIcon = (iconName: string) => {
    const iconMap: { [key: string]: any } = {
      faSearch,
      faTerminal,
      faTasks,
      faUser,
      faRobot,
      faCog,
      faPlus,
      faCheck,
      faStop,
    };
    return iconMap[iconName];
  };

  // Helper function to get Hero icon by name
  const getHeroIcon = (iconName: string) => {
    const iconMap: { [key: string]: any } = {
      ChevronDownIcon,
      ChevronRightIcon,
      HomeIcon,
      UserIcon,
      CogIcon,
    };
    return iconMap[iconName];
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">FontAwesome Icons</h3>
        <p className="text-base-content/70 mb-4">
          Rich, semantic icons for specific functionality and branding
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {fontAwesomeIcons.map((iconData) => (
            <div
              key={iconData.name}
              className="border border-base-300 rounded p-4 text-center"
            >
              <FontAwesomeIcon
                icon={getFontAwesomeIcon(iconData.iconName)}
                className="w-8 h-8 text-base-content mb-3"
              />
              <div className="font-medium text-sm mb-1">{iconData.name}</div>
              <div className="text-xs text-base-content/60 mb-2">{iconData.usage}</div>
              <code className="text-xs bg-base-200 px-2 py-1 rounded block">
                {iconData.iconName}
              </code>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Heroicons</h3>
        <p className="text-base-content/70 mb-4">
          Clean, minimal icons for navigation and interface elements
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {heroIcons.map((iconData, index) => {
            const IconComponent = getHeroIcon(iconData.iconName);
            return (
              <div key={index} className="border border-base-300 rounded p-4 text-center">
                <IconComponent className="w-8 h-8 text-base-content mb-3 mx-auto" />
                <div className="font-medium text-sm mb-1">{iconData.name}</div>
                <div className="text-xs text-base-content/60 mb-2">{iconData.usage}</div>
                <code className="text-xs bg-base-200 px-2 py-1 rounded block">
                  {iconData.iconName}
                </code>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-base-content mb-4">Icon Sizes</h3>
        <div className="flex items-end gap-6 p-4 border border-base-300 rounded">
          <div className="text-center">
            <FontAwesomeIcon icon={faSearch} className="w-4 h-4 text-base-content mb-2" />
            <div className="text-xs text-base-content/60">w-4 h-4</div>
          </div>
          <div className="text-center">
            <FontAwesomeIcon icon={faSearch} className="w-6 h-6 text-base-content mb-2" />
            <div className="text-xs text-base-content/60">w-6 h-6</div>
          </div>
          <div className="text-center">
            <FontAwesomeIcon icon={faSearch} className="w-8 h-8 text-base-content mb-2" />
            <div className="text-xs text-base-content/60">w-8 h-8</div>
          </div>
          <div className="text-center">
            <FontAwesomeIcon icon={faSearch} className="w-12 h-12 text-base-content mb-2" />
            <div className="text-xs text-base-content/60">w-12 h-12</div>
          </div>
        </div>
      </div>
    </div>
  );
}