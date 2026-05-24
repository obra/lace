// ABOUTME: Slash command handling for built-in commands like /compact, /mode, /help

import { randomUUID } from 'node:crypto';
import {
  ensureSessionFiles,
  getSessionDir,
  loadSession,
  readSessionState,
  writeSessionMeta,
  writeSessionState,
} from '@lace/agent/storage/session-store';
import { compactDroppedMessagesWithCore } from '@lace/agent/compaction/compact-dropped-messages';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { estimateTokens } from '@lace/agent/utils/token-estimation';
import { type SessionUpdate, type AgentServerState } from '@lace/agent/server-types';
import { createProviderForTurn } from './provider-factory';
import { getEffectiveConfig } from '@lace/agent/core/session';

export type SlashCommandResult = {
  turnId: string;
  stopReason: 'end_turn';
  content: { type: 'text'; text: string }[];
  usage: { inputTokens: number; outputTokens: number };
};

export type WriteAndAdvanceFn = (event: {
  type: string;
  data: Record<string, unknown>;
}) => Promise<void>;

export type EmitUpdateFn = (turnSeq: number, update: SessionUpdate) => Promise<void>;

/**
 * Get help text for a specific command.
 */
export function getCommandHelp(command: string): string {
  switch (command.toLowerCase()) {
    case 'compact':
      return `/compact - Summarize and compress context

Reduces token usage by summarizing earlier conversation history. Useful when approaching context limits.

Usage: /compact`;

    case 'clear':
      return `/clear - Clear conversation and start fresh

Creates a new session with the same working directory and configuration, giving you a clean slate.

Usage: /clear`;

    case 'mode':
      return `/mode - Show or change approval mode

Controls how the agent handles tool permissions.

Usage:
  /mode         - Show current mode
  /mode <mode>  - Change to specified mode

Available modes:
  ask           - Ask permission for each tool use (default)
  approveReads  - Auto-approve read/search operations
  approveEdits  - Auto-approve reads + file edits
  approve       - Auto-approve everything (yolo mode)
  deny          - Deny all tool use (read-only mode)`;

    case 'help':
      return `/help - Show available commands

Usage:
  /help           - List all commands
  /help <command> - Show details for a specific command`;

    case 'abort':
      return `/abort - Abort current operation

Cancels any running operation. Only useful when an operation is in progress.

Usage: /abort`;

    default:
      return `Unknown command: ${command}

Type /help for a list of available commands.`;
  }
}

/**
 * Handle built-in slash commands (e.g., /compact, /mode, /help).
 * Returns a turn result if the command was handled, or null if not recognized.
 */
export async function handleSlashCommand(
  state: AgentServerState,
  command: string,
  args: string,
  turnId: string,
  writeAndAdvance: WriteAndAdvanceFn,
  emitUpdate: EmitUpdateFn
): Promise<SlashCommandResult | null> {
  const finishTurn = async (text: string): Promise<SlashCommandResult> => {
    // Write the message event for durability
    await writeAndAdvance({
      type: 'message',
      data: { content: text },
    });
    await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'end_turn' } });
    // Emit streaming updates
    await emitUpdate(1, { type: 'text_delta', text });
    await emitUpdate(2, {
      type: 'turn_end',
      stopReason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    return {
      turnId,
      stopReason: 'end_turn' as const,
      content: [{ type: 'text' as const, text }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  };

  switch (command.toLowerCase()) {
    case 'compact': {
      // Trigger context compaction
      if (!state.activeSession) {
        return finishTurn('Error: No active session.');
      }

      try {
        // Use the summarize strategy for compaction
        const sessionDir = state.activeSession.dir;
        const sessionId = state.activeSession.meta.sessionId;
        const { messages: providerMessages, systemPrompt } =
          buildProviderMessagesFromDurableEvents(sessionDir);

        // Check if there's anything worth compacting: either multiple messages
        // or a substantial system prompt. Include system prompt tokens in the budget.
        const messageTokens = providerMessages.reduce(
          (sum, msg) => sum + estimateTokens(String(msg.content)),
          0
        );
        const systemPromptTokens = estimateTokens(systemPrompt);
        const totalTokens = messageTokens + systemPromptTokens;

        if (providerMessages.length < 2 && totalTokens < 1000) {
          return finishTurn('Context is already minimal. Nothing to compact.');
        }

        // Get effective config for provider creation
        const effectiveConfig = getEffectiveConfig(state.config, state.activeSession.state.config);

        const provider = await createProviderForTurn({
          connectionId: effectiveConfig.connectionId,
          modelId: effectiveConfig.modelId,
        });

        const result = await compactDroppedMessagesWithCore({
          strategyId: 'summarize',
          dropped: providerMessages.slice(0, -1),
          provider,
          modelId: effectiveConfig.modelId,
          threadId: sessionId,
        });

        if (result.summary) {
          // Write compaction event
          await writeAndAdvance({
            type: 'compaction',
            data: {
              summary: result.summary,
              droppedCount: providerMessages.length - 1,
            },
          });
          return finishTurn(`Context compacted. Summary:\n\n${result.summary}`);
        } else {
          return finishTurn('Compaction completed but no summary was generated.');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return finishTurn(`Error during compaction: ${msg}`);
      }
    }

    case 'clear': {
      // Clear the conversation - create a new session with the same workdir
      if (!state.activeSession) {
        return finishTurn('Error: No active session.');
      }

      try {
        const workDir = state.activeSession.meta.workDir;
        const sessionConfig = state.activeSession.state.config;

        // Create a new session
        const newSessionId = `sess_${randomUUID()}`;
        const created = new Date().toISOString();
        const newSessionDir = getSessionDir(newSessionId);

        writeSessionMeta(newSessionDir, { sessionId: newSessionId, workDir, created });
        writeSessionState(newSessionDir, {
          nextEventSeq: 0,
          nextStreamSeq: 0,
          config: sessionConfig,
        });
        ensureSessionFiles(newSessionDir);

        // Switch to the new session
        state.activeSession = loadSession(newSessionId);

        // Notify the client that the session has changed
        await emitUpdate(0, {
          type: 'session_changed',
          newSessionId,
          reason: 'clear',
        } as SessionUpdate);

        return finishTurn(`Conversation cleared. New session: ${newSessionId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return finishTurn(`Error clearing conversation: ${msg}`);
      }
    }

    case 'mode': {
      // Change approval mode
      if (!args) {
        const currentMode =
          state.activeSession?.state.config?.approvalMode ?? state.config.approvalMode ?? 'ask';
        return finishTurn(
          `Current approval mode: ${currentMode}\n\nAvailable modes:\n- ask: Ask permission for each tool use\n- approveReads: Auto-approve read/search operations\n- approveEdits: Auto-approve reads + file edits\n- approve: Auto-approve everything\n- deny: Deny all tool use (read-only)`
        );
      }

      const validModes = new Set([
        'ask',
        'approveReads',
        'approveEdits',
        'approve',
        'deny',
        'dangerouslySkipPermissions',
      ]);

      if (!validModes.has(args)) {
        return finishTurn(
          `Invalid mode: ${args}\n\nValid modes: ask, approveReads, approveEdits, approve, deny`
        );
      }

      if (!state.activeSession) {
        return finishTurn('Error: No active session.');
      }

      try {
        const currentState = readSessionState(state.activeSession.dir);
        const nextConfig = {
          ...currentState.config,
          approvalMode: args as typeof state.config.approvalMode,
        };
        const nextState = { ...currentState, config: nextConfig };
        writeSessionState(state.activeSession.dir, nextState);
        state.activeSession = loadSession(state.activeSession.meta.sessionId);

        return finishTurn(`Approval mode changed to: ${args}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return finishTurn(`Error changing mode: ${msg}`);
      }
    }

    case 'help': {
      // Show available commands
      const helpText = args
        ? getCommandHelp(args)
        : `Available slash commands:

/compact - Summarize and compress context to reduce token usage
/clear - Clear conversation and start fresh (creates new session)
/mode [mode] - Show or change approval mode
/help [command] - Show this help or details for a specific command

Type /help <command> for more details on a specific command.`;

      return finishTurn(helpText);
    }

    case 'abort': {
      // Abort doesn't make sense in session/prompt since we're starting a new turn
      return finishTurn(
        'The /abort command is used to cancel an in-progress operation. Since this is a new prompt, there is nothing to abort.'
      );
    }

    default:
      // Command not recognized - return null to fall through to normal processing
      return null;
  }
}
