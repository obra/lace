'use client';

import React, { useState } from 'react';
import { faUser } from '@/lib/fontawesome';

// Import all migrated components organized by category
// ATOMS - Single-purpose UI building blocks
import {
  Alert,
  AgentBadge,
  TokenUsageDisplay,
  SendButton,
  DirectoryField,
  VoiceButton,
  FileAttachButton,
  Avatar,
  Badge,
  StatusDot,
  ChatTextarea,
  SectionHeader,
  MessageText,
  TimestampDisplay,
  MessageHeader,
} from '@/components/ui';

// ATOMS - Named exports from individual files
import { AnimatedButton } from '@/components/ui/AnimatedButton';
import { AccentInput } from '@/components/ui/AccentInput';
import { AccentSelect } from '@/components/ui/AccentSelect';
import { StreamingIndicator } from '@/components/ui/StreamingIndicator';
import { GlassCard } from '@/components/ui/GlassCard';
import { SwipeableCard } from '@/components/ui/SwipeableCard';
import { DragDropOverlay } from '@/components/ui/DragDropOverlay';

// ATOMS - Named exports continued
import { FileAttachment } from '@/components/ui/FileAttachment';
import { AnimatedCarousel } from '@/components/ui/AnimatedCarousel';
import MessageDisplay from '@/components/ui/MessageDisplay';
import { VoiceRecognitionUI, CompactVoiceButton } from '@/components/ui/VoiceRecognitionUI';
import { NativeSpeechInput } from '@/components/ui';
import { AccountDropdown } from '@/components/ui/AccountDropdown';
import SidebarSection from '@/components/ui/SidebarSection';
import NavigationItem from '@/components/ui/NavigationItem';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import NavigationButton from '@/components/ui/NavigationButton';
import { AdvancedSettingsCollapse } from '@/components/ui/AdvancedSettingsCollapse';
import { ThemeSelector } from '@/components/ui/ThemeSelector';
import ExpandableHeader from '@/components/ui/ExpandableHeader';
import { InfoSection } from '@/components/ui/InfoSection';
import { VaporBackground } from '@/components/ui/VaporBackground';
import { InfoIconButton } from '@/components/ui/InfoIconButton';
import { OnboardingHero } from '@/components/ui/OnboardingHero';
import MessageBubble from '@/components/ui/MessageBubble';
import { OnboardingActions } from '@/components/ui/OnboardingActions';

// ADDITIONAL MISSING COMPONENTS
import { AccentButton } from '@/components/ui/AccentButton';
import IconButton from '@/components/ui/IconButton';
import LoadingDots from '@/components/ui/LoadingDots';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import SkeletonLoader from '@/components/ui/SkeletonLoader';
import InlineCode from '@/components/ui/InlineCode';
import { Modal } from '@/components/ui/Modal';
import { Carousel } from '@/components/ui/Carousel';
import CodeBlock from '@/components/ui/CodeBlock';
// import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
// import FileRenderer from '@/components/ui/FileRenderer';
import LLMModelBadge from '@/components/ui/LLMModelBadge';
import { TechnicalDetailsToggle } from '@/components/ui/TechnicalDetailsToggle';
import { ToolCallDisplay } from '@/components/ui/ToolCallDisplay';
import { TextAreaField } from '@/components/ui/TextAreaField';

// MOLECULES - Composed UI patterns
import { UISettingsPanel } from '@/components/settings/panels/UISettingsPanel';
import { ChatInput } from '@/components/chat/ChatInput';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileSidebar } from '@/components/layout/MobileSidebar';
// Removed unused feedback and files imports to satisfy lints

// ORGANISMS - Complex interactive components
import GoogleDocChatMessage from '@/components/organisms/GoogleDocChatMessage';
import { TaskBoardModal } from '@/components/modals/TaskBoardModal';

type ComponentCategory = 'atoms' | 'molecules' | 'organisms' | 'all';

// Helper: Tooltip + Badge wrapper with padded content so badge doesn't overlap component
const AtomItem: React.FC<{
  n: number;
  tip: string;
  className?: string;
  children: React.ReactNode;
}> = ({ n, tip, className, children }) => (
  <div className={`tooltip relative inline-block ${className ?? ''}`} data-tip={tip}>
    <span className="absolute -top-2 -left-2 z-10 h-5 w-5 flex items-center justify-center text-[10px] bg-primary text-primary-content rounded-full shadow pointer-events-none select-none">
      {n}
    </span>
    <div className="p-6 rounded-box border border-base-300/40 bg-base-200/40">{children}</div>
  </div>
);

/**
 * Playground for testing all migrated components organized by Atomic Design principles
 */
export default function PlaygroundPage() {
  const [activeCategory, setActiveCategory] = useState<ComponentCategory>('atoms');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showBasicModal, setShowBasicModal] = useState(false);
  const [showAnimatedModal, setShowAnimatedModal] = useState(false);

  const renderAtoms = () => (
    <div className="grid gap-6">
      {/* Identity & Status */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            🏷️ Identity & Status
            <span className="badge badge-outline ml-2">Atoms 1-7</span>
          </h3>
          <div className="flex gap-2 flex-wrap items-center">
            <AtomItem n={1} tip="Atom #1: AgentBadge">
              <AgentBadge agent="Claude" size="xs" />
            </AtomItem>
            <div className="tooltip" data-tip="Atom #1: AgentBadge (different size)">
              <AgentBadge agent="GPT-4" size="sm" />
            </div>
            <div className="tooltip" data-tip="Atom #1: AgentBadge (different size)">
              <AgentBadge agent="Gemini" size="md" />
            </div>
            <AtomItem n={2} tip="Atom #2: StatusDot">
              <StatusDot status="online" />
            </AtomItem>
            <div className="tooltip" data-tip="Atom #2: StatusDot (different state)">
              <StatusDot status="offline" />
            </div>
            <AtomItem n={3} tip="Atom #3: Avatar">
              <Avatar role="assistant" size="sm" />
            </AtomItem>
            <AtomItem n={4} tip="Atom #4: Badge">
              <Badge variant="primary">Primary</Badge>
            </AtomItem>
            <div className="tooltip" data-tip="Atom #4: Badge (different variant)">
              <Badge variant="secondary">Secondary</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            🔘 Action Buttons
            <span className="badge badge-outline ml-2">Atoms 5-10</span>
          </h3>
          <div className="flex gap-3 flex-wrap">
            <AtomItem n={5} tip="Atom #5: SendButton">
              <SendButton />
            </AtomItem>
            <AtomItem n={6} tip="Atom #6: AnimatedButton">
              <AnimatedButton>Animated</AnimatedButton>
            </AtomItem>
            <AtomItem n={7} tip="Atom #7: VoiceButton">
              <VoiceButton isListening={false} onToggle={() => {}} />
            </AtomItem>
            <AtomItem n={8} tip="Atom #8: FileAttachButton">
              <FileAttachButton onFilesSelected={() => {}} />
            </AtomItem>
            <AtomItem n={9} tip="Atom #9: InfoIconButton">
              <InfoIconButton label="Info" onClick={() => {}} />
            </AtomItem>
            <AtomItem n={10} tip="Atom #10: NavigationButton">
              <NavigationButton icon={faUser} onClick={() => {}} title="Navigate" />
            </AtomItem>
            <AtomItem n={39} tip="Atom #39: AccentButton">
              <AccentButton>Accent</AccentButton>
            </AtomItem>
            <AtomItem n={40} tip="Atom #40: IconButton">
              <IconButton icon={faUser} onClick={() => {}} />
            </AtomItem>
            <AtomItem n={41} tip="Atom #41: CompactVoiceButton">
              <CompactVoiceButton isListening={false} onToggle={() => {}} />
            </AtomItem>
            <AtomItem n={55} tip="Atom #55: NativeSpeechInput">
              <NativeSpeechInput
                onTranscript={(text) => void text}
                onError={(error) => void error}
                size="md"
                variant="ghost"
              />
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Form Inputs */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">📝 Form Inputs</h3>
          <div className="space-y-3 max-w-md">
            <AtomItem n={13} tip="Atom #13: DirectoryField">
              <DirectoryField
                value="/Users/example"
                onChange={() => {}}
                placeholder="Select directory..."
              />
            </AtomItem>
            <AtomItem n={15} tip="Atom #15: AccentInput">
              <AccentInput placeholder="Accent input example" />
            </AtomItem>
            <AtomItem n={14} tip="Atom #14: AccentSelect">
              <AccentSelect
                options={[
                  { value: 'option1', label: 'Option 1' },
                  { value: 'option2', label: 'Option 2' },
                ]}
              />
            </AtomItem>
            <AtomItem n={11} tip="Atom #11: ChatTextarea">
              <ChatTextarea value="" onChange={() => {}} placeholder="Type your message..." />
            </AtomItem>
            <AtomItem n={42} tip="Atom #42: TextAreaField">
              <TextAreaField
                label="Text Area"
                value=""
                onChange={() => {}}
                placeholder="Enter text here..."
              />
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Display Components */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">📊 Display & Content</h3>
          <div className="space-y-4">
            <AtomItem n={12} tip="Atom #12: TimestampDisplay">
              <TimestampDisplay timestamp={new Date()} />
            </AtomItem>
            <AtomItem n={38} tip="Atom #38: StreamingIndicator">
              <StreamingIndicator isVisible={true} />
            </AtomItem>
            <AtomItem n={19} tip="Atom #19: MessageText">
              <MessageText content="Example message text with **markdown** support" />
            </AtomItem>
            <AtomItem n={20} tip="Atom #20: TokenUsageDisplay">
              <TokenUsageDisplay
                tokenUsage={{
                  totalPromptTokens: 150,
                  totalCompletionTokens: 75,
                  totalTokens: 225,
                  contextLimit: 200000,
                  percentUsed: 225 / 200000,
                  nearLimit: false,
                }}
              />
            </AtomItem>
            <AtomItem n={21} tip="Atom #21: SectionHeader">
              <SectionHeader title="Section Title" isExpanded={true} onToggle={() => {}} />
            </AtomItem>
            <AtomItem n={22} tip="Atom #22: MessageDisplay">
              <MessageDisplay type="ai" content="Sample message content" timestamp={new Date()} />
            </AtomItem>
            <AtomItem n={43} tip="Atom #43: LoadingDots">
              <LoadingDots />
            </AtomItem>
            <AtomItem n={44} tip="Atom #44: LoadingSkeleton">
              <LoadingSkeleton />
            </AtomItem>
            <AtomItem n={45} tip="Atom #45: SkeletonLoader">
              <SkeletonLoader />
            </AtomItem>
            <AtomItem n={46} tip="Atom #46: InlineCode">
              <InlineCode code='console.log("Hello")' />
            </AtomItem>
            <AtomItem n={47} tip="Atom #47: LLMModelBadge">
              <LLMModelBadge model="Claude 3.5 Sonnet" />
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Cards & Containers */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">🎴 Cards & Containers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AtomItem n={23} tip="Atom #23: GlassCard">
              <GlassCard>
                <p className="p-4">Glass card with transparent effect</p>
              </GlassCard>
            </AtomItem>
            <AtomItem n={24} tip="Atom #24: SwipeableCard">
              <SwipeableCard>
                <p className="p-4">Swipeable card content</p>
              </SwipeableCard>
            </AtomItem>
            <AtomItem n={25} tip="Atom #25: MessageBubble">
              <MessageBubble
                role="user"
                header={{ name: 'You', timestamp: new Date().toLocaleTimeString() }}
              >
                Sample message bubble
              </MessageBubble>
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Alerts & Notifications */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            🚨 Alerts & Notifications
            <span className="badge badge-outline ml-2">Atoms 56-59</span>
          </h3>
          <div className="space-y-4">
            <AtomItem n={56} tip="Atom #56: Alert Success">
              <Alert
                variant="success"
                title="Settings are saved"
                description="Your preferences are automatically saved and will persist between sessions."
              />
            </AtomItem>
            <AtomItem n={57} tip="Atom #57: Alert Warning">
              <Alert
                variant="warning"
                title="Settings are not saved"
                description="Your user preferences are only stored during this session."
              />
            </AtomItem>
            <AtomItem n={58} tip="Atom #58: Alert Error">
              <Alert
                variant="error"
                title="Failed to save"
                description="There was an error saving your settings. Please try again."
              />
            </AtomItem>
            <AtomItem n={59} tip="Atom #59: Alert Info">
              <Alert
                variant="info"
                title="Hardware permissions required"
                description="This demo uses native OS-level speech recognition."
              />
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Interactive Elements */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">⚡ Interactive Elements</h3>
          <div className="space-y-4">
            <AtomItem n={26} tip="Atom #26: VoiceRecognitionUI">
              <VoiceRecognitionUI
                isListening={false}
                onStartListening={() => {}}
                onStopListening={() => {}}
              />
            </AtomItem>
            <AtomItem n={16} tip="Atom #16: NavigationItem">
              <NavigationItem title="Home" subtitle="Navigation example" isActive={false} />
            </AtomItem>
            <AtomItem n={27} tip="Atom #27: ExpandableHeader">
              <ExpandableHeader title="Expandable Section" isExpanded={true} onToggle={() => {}} />
            </AtomItem>
            <AtomItem n={18} tip="Atom #18: ThemeSelector">
              <ThemeSelector />
            </AtomItem>
            <AtomItem n={17} tip="Atom #17: AdvancedSettingsCollapse">
              <AdvancedSettingsCollapse>
                <p>Advanced settings content</p>
              </AdvancedSettingsCollapse>
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Specialized Atoms */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">🎯 Specialized Atoms</h3>
          <div className="space-y-4">
            <AtomItem n={28} tip="Atom #28: OnboardingHero">
              <OnboardingHero
                title="Welcome to Lace"
                primaryLabel="Get Started"
                onPrimary={() => {}}
                secondaryLabel="Learn More"
                onSecondary={() => {}}
              />
            </AtomItem>
            <AtomItem n={29} tip="Atom #29: OnboardingActions">
              <OnboardingActions primaryLabel="Continue" onPrimary={() => {}} />
            </AtomItem>
            <AtomItem n={30} tip="Atom #30: AccountDropdown">
              <AccountDropdown />
            </AtomItem>
            <AtomItem n={31} tip="Atom #31: SidebarSection">
              <SidebarSection title="Section" isExpanded={true} onToggle={() => {}}>
                <p>Sidebar section content</p>
              </SidebarSection>
            </AtomItem>
            <AtomItem n={32} tip="Atom #32: InfoSection">
              <InfoSection title="Information">Detailed information content</InfoSection>
            </AtomItem>
            <AtomItem n={33} tip="Atom #33: AnimatedCarousel">
              <AnimatedCarousel>
                <div className="p-4 bg-base-200 rounded">Item 1</div>
                <div className="p-4 bg-base-200 rounded">Item 2</div>
              </AnimatedCarousel>
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Effects & Overlays */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">✨ Effects & Overlays</h3>
          <div className="space-y-4">
            <AtomItem n={34} tip="Atom #34: VaporBackground">
              <VaporBackground />
            </AtomItem>
            <AtomItem n={35} tip="Atom #35: DragDropOverlay">
              <DragDropOverlay onFilesDropped={() => {}}>
                <div className="p-8 text-center border border-dashed rounded">Drop files here</div>
              </DragDropOverlay>
            </AtomItem>
            <AtomItem n={37} tip="Atom #37: AnimatedModal (open below)">
              <button className="btn btn-outline" onClick={() => setShowAnimatedModal(true)}>
                Show Animated Modal
              </button>
            </AtomItem>
          </div>
        </div>
      </div>

      {/* File Components */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">📁 File & Content Components</h3>
          <div className="space-y-4">
            <AtomItem n={36} tip="Atom #36: FileAttachment">
              <FileAttachment
                attachedFiles={[]}
                onFilesAttached={() => {}}
                onFileRemoved={() => {}}
                onFileCleared={() => {}}
              />
            </AtomItem>
            <AtomItem n={48} tip="Atom #48: CodeBlock">
              <CodeBlock language="javascript" code="const hello = 'world';" />
            </AtomItem>
            {/* <AtomItem n={49} tip="Atom #49: MarkdownRenderer">
              <MarkdownRenderer content="**Bold** text with *italics*" />
            </AtomItem>
            <AtomItem n={50} tip="Atom #50: FileRenderer">
              <FileRenderer fileName="example.txt" content="File content here" />
            </AtomItem> */}
            <AtomItem n={51} tip="Atom #51: TechnicalDetailsToggle">
              <TechnicalDetailsToggle details={{ example: 'data' }}>
                <div className="p-2">Component content</div>
              </TechnicalDetailsToggle>
            </AtomItem>
          </div>
        </div>
      </div>

      {/* Advanced Components */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title text-base-content">🛠️ Advanced Components</h3>
          <div className="space-y-4">
            <AtomItem n={52} tip="Atom #52: ToolCallDisplay">
              <ToolCallDisplay
                tool="example_tool"
                content="Tool execution content"
                timestamp={new Date()}
              />
            </AtomItem>
            <AtomItem n={53} tip="Atom #53: Modal">
              <div>
                <button className="btn btn-outline" onClick={() => setShowBasicModal(true)}>
                  Modal Example (click to open modal)
                </button>
                <p className="text-xs text-base-content/60 mt-1">
                  Modal component for overlay dialogs
                </p>
              </div>
            </AtomItem>
            <AtomItem n={54} tip="Atom #54: Carousel">
              <Carousel>
                <div className="p-4 bg-primary text-primary-content rounded">Slide 1</div>
                <div className="p-4 bg-secondary text-secondary-content rounded">Slide 2</div>
                <div className="p-4 bg-accent text-accent-content rounded">Slide 3</div>
              </Carousel>
            </AtomItem>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMolecules = () => (
    <div className="grid gap-6">
      {/* Chat Molecules - WORKING */}
      <div className="card bg-base-100 shadow border-l-4 border-l-secondary">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            💬 Chat Components
            <span className="badge badge-secondary ml-2">Molecules 1-2</span>
          </h3>
          <div className="space-y-4 max-w-lg">
            <div className="border border-secondary/20 rounded p-3 bg-secondary/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm bg-secondary/20 text-secondary px-2 py-1 rounded">M1</span>
                <span className="text-sm font-medium">MessageHeader</span>
                <div className="text-xs text-base-content/60">
                  Uses: <span className="text-primary">Avatar(3)</span> +{' '}
                  <span className="text-primary">Badge(4)</span> +{' '}
                  <span className="text-primary">TimestampDisplay(12)</span>
                </div>
              </div>
              <MessageHeader role="assistant" name="Claude" timestamp={new Date()} />
            </div>

            <div className="border border-secondary/20 rounded p-3 bg-secondary/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm bg-secondary/20 text-secondary px-2 py-1 rounded">M2</span>
                <span className="text-sm font-medium">ChatInput (Production)</span>
                <div className="text-xs text-base-content/60">
                  Uses: <span className="text-primary">NativeSpeechInput(55)</span> + circular
                  emerald send button + file attachment
                </div>
              </div>
              <ChatInput
                value=""
                onChange={() => {}}
                onSubmit={() => {}}
                placeholder="Production chat input with native speech..."
                showVoiceButton={true}
                showFileAttachment={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Layout Molecules - WORKING */}
      <div className="card bg-base-100 shadow border-l-4 border-l-secondary">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            🏗️ Layout Components
            <span className="badge badge-secondary ml-2">Molecules 3-4</span>
          </h3>
          <div className="grid gap-4">
            <div className="border border-secondary/20 rounded p-3 bg-secondary/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm bg-secondary/20 text-secondary px-2 py-1 rounded">M3</span>
                <span className="text-sm font-medium">Sidebar</span>
                <div className="text-xs text-base-content/60">
                  Uses: <span className="text-primary">NavigationItem(16)</span> +{' '}
                  <span className="text-primary">NavigationButton(10)</span>
                </div>
              </div>
              <div className="max-w-xs">
                <Sidebar isOpen={true} onToggle={() => {}} onSettingsClick={() => {}}>
                  <div>Sidebar content</div>
                </Sidebar>
              </div>
            </div>

            <div className="border border-secondary/20 rounded p-3 bg-secondary/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm bg-secondary/20 text-secondary px-2 py-1 rounded">M4</span>
                <span className="text-sm font-medium">MobileSidebar</span>
                <div className="text-xs text-base-content/60">
                  Uses: <span className="text-primary">NavigationItem(16)</span> + responsive
                  behavior
                </div>
              </div>
              <div className="max-w-xs">
                <MobileSidebar isOpen={true} onClose={() => {}} onSettingsClick={() => {}}>
                  <div>Mobile sidebar content</div>
                </MobileSidebar>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Molecules - TESTING */}
      <div className="card bg-base-100 shadow border-l-4 border-l-secondary">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            ⚙️ Settings Panels
            <span className="badge badge-secondary ml-2">Molecule 5</span>
          </h3>
          <div className="border border-secondary/20 rounded p-3 bg-secondary/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm bg-secondary/20 text-secondary px-2 py-1 rounded">M5</span>
              <span className="text-sm font-medium">UISettingsPanel</span>
              <div className="text-xs text-base-content/60">
                Uses: <span className="text-primary">Alert Success(56)</span> +{' '}
                <span className="text-primary">ThemeSelector(18)</span>
              </div>
            </div>
            <UISettingsPanel />
          </div>
        </div>
      </div>
    </div>
  );

  const renderOrganisms = () => (
    <div className="grid gap-6">
      <div className="card bg-base-100 shadow border-l-4 border-l-accent">
        <div className="card-body">
          <h3 className="card-title text-base-content">
            🦠 Complex Interactive Components
            <span className="badge badge-accent ml-2">Organisms 1-3</span>
          </h3>

          <div className="space-y-6">
            <div className="border border-accent/20 rounded p-4 bg-accent/5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm bg-accent/20 text-accent px-2 py-1 rounded">O1</span>
                <span className="text-lg font-semibold">TaskBoardModal</span>
              </div>
              <div className="text-sm text-base-content/70 mb-3">
                <strong>Composition:</strong> Full kanban board with drag-and-drop task management
              </div>
              <div className="text-xs bg-base-200 p-2 rounded mb-3">
                <strong>Built from:</strong>
                <br />
                🧪 <span className="text-secondary">Molecules:</span> MessageHeader(M1),
                ChatInput(M2)
                <br />
                🔬 <span className="text-primary">Atoms:</span> Badge(4), AnimatedButton(6),
                StatusDot(2), Avatar(3), NavigationButton(10)
              </div>
              <button className="btn btn-primary" onClick={() => setShowTaskModal(true)}>
                Open Task Board
              </button>
            </div>

            <div className="border border-accent/20 rounded p-4 bg-accent/5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm bg-accent/20 text-accent px-2 py-1 rounded">O2</span>
                <span className="text-lg font-semibold">GoogleDocChatMessage</span>
              </div>
              <div className="text-sm text-base-content/70 mb-3">
                <strong>Composition:</strong> Document-style chat message with rich formatting and
                collaborative features
              </div>
              <div className="text-xs bg-base-200 p-2 rounded mb-3">
                <strong>Built from:</strong>
                <br />
                🧪 <span className="text-secondary">Molecules:</span> MessageHeader(M1)
                <br />
                🔬 <span className="text-primary">Atoms:</span> MessageText(19),
                TimestampDisplay(12), Avatar(3), Badge(4)
              </div>
              <GoogleDocChatMessage
                message={{
                  id: '1',
                  content:
                    'This is a sample Google Doc style message with rich formatting and collaborative features.',
                  role: 'assistant',
                  timestamp: new Date(),
                }}
              />
            </div>

            <div className="border border-accent/20 rounded p-4 bg-accent/5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm bg-accent/20 text-accent px-2 py-1 rounded">O3</span>
                <span className="text-lg font-semibold">Settings Dashboard</span>
              </div>
              <div className="text-sm text-base-content/70 mb-3">
                <strong>Composition:</strong> Complete settings interface with alert notifications
                and theme controls
              </div>
              <div className="text-xs bg-base-200 p-2 rounded mb-3">
                <strong>Built from:</strong>
                <br />
                🧪 <span className="text-secondary">Molecules:</span> UISettingsPanel(M5)
                <br />
                🔬 <span className="text-primary">Atoms:</span> Alert Success(56), Alert
                Warning(57), ThemeSelector(18), Badge(4)
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-base-200/50 rounded-lg">
                  <h4 className="text-sm font-medium mb-2">Settings with Success Alert</h4>
                  <UISettingsPanel />
                </div>
                <div className="p-4 bg-base-200/50 rounded-lg">
                  <h4 className="text-sm font-medium mb-2">Standalone Alert Examples</h4>
                  <div className="space-y-2">
                    <Alert
                      variant="warning"
                      title="Warning example"
                      description="This shows how alerts integrate into organisms."
                    />
                    <Alert
                      variant="info"
                      title="Info example"
                      description="Alerts provide contextual feedback."
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAll = () => (
    <div className="space-y-12">
      <div>
        <h2 className="text-3xl font-bold mb-6 text-base-content flex items-center gap-2">
          🔬 Atoms
          <span className="badge badge-primary">59 components</span>
        </h2>
        <p className="text-base-content/70 mb-6">
          Single-purpose UI building blocks - buttons, inputs, icons, labels, and other fundamental
          elements
        </p>
        {renderAtoms()}
      </div>

      <div>
        <h2 className="text-3xl font-bold mb-6 text-base-content flex items-center gap-2">
          🧪 Molecules
          <span className="badge badge-secondary">5 components</span>
        </h2>
        <p className="text-base-content/70 mb-6">
          Composed UI patterns - combinations of atoms that solve specific interface problems
        </p>
        {renderMolecules()}
      </div>

      <div>
        <h2 className="text-3xl font-bold mb-6 text-base-content flex items-center gap-2">
          🦠 Organisms
          <span className="badge badge-accent">2 components</span>
        </h2>
        <p className="text-base-content/70 mb-6">
          Complex interactive components - sophisticated UI patterns with multiple behaviors
        </p>
        {renderOrganisms()}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeCategory) {
      case 'atoms':
        return renderAtoms();
      case 'molecules':
        return renderMolecules();
      case 'organisms':
        return renderOrganisms();
      case 'all':
        return renderAll();
      default:
        return renderAtoms();
    }
  };

  return (
    <div className="container mx-auto p-8 bg-base-100 min-h-screen">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4 text-base-content">Component Playground</h1>
        <p className="text-lg text-base-content/70 mb-4">
          Test all migrated components organized by Atomic Design principles
        </p>
        <div className="alert alert-info max-w-4xl mx-auto text-left">
          <div>
            <h4 className="font-bold">🧬 Atomic Design System</h4>
            <div className="text-sm mt-2">
              <p>
                <span className="text-primary font-semibold">🔬 Atoms:</span> Basic building blocks
                (buttons, inputs, icons) - numbered 1-38
              </p>
              <p>
                <span className="text-secondary font-semibold">🧪 Molecules:</span> Groups of atoms
                working together (chat inputs, headers) - numbered M1-M6
              </p>
              <p>
                <span className="text-accent font-semibold">🦠 Organisms:</span> Complex components
                made from molecules and atoms - numbered O1-O2
              </p>
              <p className="mt-2 text-xs">
                <strong>How to read:</strong> Hover over numbered components for details. Molecules
                show which atoms they use. Organisms show their molecular and atomic composition.
              </p>
            </div>
          </div>
        </div>
        <div className="stats shadow">
          <div className="stat">
            <div className="stat-title">Total Components</div>
            <div className="stat-value text-primary">62</div>
            <div className="stat-desc">UI Components Available</div>
          </div>
          <div className="stat">
            <div className="stat-title">Categories</div>
            <div className="stat-value text-secondary">3</div>
            <div className="stat-desc">Atoms, Molecules, Organisms</div>
          </div>
          <div className="stat">
            <div className="stat-title">Coverage</div>
            <div className="stat-value text-accent">100%</div>
            <div className="stat-desc">Including Native Speech</div>
          </div>
        </div>
      </div>

      <div className="bg-base-200 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-bold mb-4 text-base-content">Component Categories</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            className={`btn ${activeCategory === 'atoms' ? 'btn-primary' : 'btn-outline'} btn-sm md:btn-md`}
            onClick={() => setActiveCategory('atoms')}
          >
            <span className="hidden sm:inline">🔬 Atoms</span>
            <span className="sm:hidden">Atoms</span>
            <span className="ml-1">(55)</span>
          </button>
          <button
            className={`btn ${activeCategory === 'molecules' ? 'btn-primary' : 'btn-outline'} btn-sm md:btn-md`}
            onClick={() => setActiveCategory('molecules')}
          >
            <span className="hidden sm:inline">🧪 Molecules</span>
            <span className="sm:hidden">Molecules</span>
            <span className="ml-1">(5)</span>
          </button>
          <button
            className={`btn ${activeCategory === 'organisms' ? 'btn-primary' : 'btn-outline'} btn-sm md:btn-md`}
            onClick={() => setActiveCategory('organisms')}
          >
            <span className="hidden sm:inline">🦠 Organisms</span>
            <span className="sm:hidden">Organisms</span>
            <span className="ml-1">(2)</span>
          </button>
          <button
            className={`btn ${activeCategory === 'all' ? 'btn-primary' : 'btn-outline'} btn-sm md:btn-md`}
            onClick={() => setActiveCategory('all')}
          >
            <span className="hidden sm:inline">📚 View All</span>
            <span className="sm:hidden">All</span>
            <span className="ml-1">(62)</span>
          </button>
        </div>
      </div>

      <div className="min-h-96">{renderContent()}</div>

      {/* Modals */}
      <TaskBoardModal isOpen={showTaskModal} onClose={() => setShowTaskModal(false)} tasks={[]} />

      <Modal
        isOpen={showBasicModal}
        onClose={() => setShowBasicModal(false)}
        title="Basic Modal Example"
      >
        <p>This is a basic modal component with a title and content area.</p>
        <div className="mt-4">
          <button className="btn btn-primary" onClick={() => setShowBasicModal(false)}>
            Close Modal
          </button>
        </div>
      </Modal>

      <AnimatedModal
        isOpen={showAnimatedModal}
        onClose={() => setShowAnimatedModal(false)}
        title="Animated Modal"
      >
        <p>This is an animated modal with smooth transitions.</p>
      </AnimatedModal>

      <div className="alert alert-info mt-8">
        <div>
          <h4 className="font-bold">📖 Migration Complete!</h4>
          <p className="text-sm mt-1">
            All 62 UI components are now showcased in this playground, including native OS-level
            speech recognition. Each component includes usage examples and interactive
            demonstrations. Components are organized by Atomic Design principles for better
            understanding of the design system.
          </p>
        </div>
      </div>
    </div>
  );
}
