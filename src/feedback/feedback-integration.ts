// ABOUTME: Integration layer connecting contextual feedback with agent and tool systems
// ABOUTME: Provides seamless feedback integration without disrupting existing event flows

import { ContextualFeedback, SessionMetrics } from './contextual-feedback';
import { FeedbackConfig, FeedbackContext } from './types';
import { Agent, AgentEvents, CurrentTurnMetrics } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { ThreadEvent } from '~/threads/types';
import { logger } from '~/utils/logger';

export interface FeedbackIntegrationConfig extends FeedbackConfig {
  autoAttach: boolean;
  trackPerformance: boolean;
  trackErrors: boolean;
  trackToolUsage: boolean;
  trackTurns: boolean;
}

export class FeedbackIntegration {
  private _feedback: ContextualFeedback;
  public _config: FeedbackIntegrationConfig; // Make config public for factory access
  private _attachedAgents = new Map<Agent, Set<string>>();
  private _attachedToolExecutors = new Map<ToolExecutor, Set<string>>();
  private _attachedThreadManagers = new Map<ThreadManager, Set<string>>();
  private _currentTurnMetrics = new Map<string, CurrentTurnMetrics>();

  constructor(config: FeedbackIntegrationConfig, context: FeedbackContext) {
    this._config = config;
    this._feedback = new ContextualFeedback(config, context);
    
    logger.info('FeedbackIntegration initialized', {
      threadId: context.threadId,
      autoAttach: config.autoAttach,
      trackPerformance: config.trackPerformance
    });
  }

  // Get the underlying feedback system
  get feedback(): ContextualFeedback {
    return this._feedback;
  }

  // Agent integration
  attachToAgent(agent: Agent): void {
    if (this._attachedAgents.has(agent)) {
      logger.warn('Agent already attached to feedback system');
      return;
    }

    const listeners = new Set<string>();

    // Core agent events
    if (this._config.trackTurns) {
      const turnStartListener = 'turn_start';
      agent.on(turnStartListener, ({ turnId, userInput, metrics }) => {
        this._currentTurnMetrics.set(turnId, metrics);
        this._feedback.processAgentEvent('turn_start', { turnId, userInput, metrics });
      });
      listeners.add(turnStartListener);

      const turnCompleteListener = 'turn_complete';
      agent.on(turnCompleteListener, ({ turnId, metrics }) => {
        this._feedback.processAgentEvent('turn_complete', { turnId, metrics });
        this._currentTurnMetrics.delete(turnId);
      });
      listeners.add(turnCompleteListener);

      const turnAbortedListener = 'turn_aborted';
      agent.on(turnAbortedListener, ({ turnId, metrics }) => {
        this._feedback.processAgentEvent('turn_aborted', { turnId, metrics });
        this._currentTurnMetrics.delete(turnId);
      });
      listeners.add(turnAbortedListener);
    }

    // Thinking and response events
    const thinkingStartListener = 'agent_thinking_start';
    agent.on(thinkingStartListener, () => {
      this._feedback.processAgentEvent('agent_thinking_start', {});
    });
    listeners.add(thinkingStartListener);

    const thinkingCompleteListener = 'agent_thinking_complete';
    agent.on(thinkingCompleteListener, () => {
      this._feedback.processAgentEvent('agent_thinking_complete', {});
    });
    listeners.add(thinkingCompleteListener);

    const responseCompleteListener = 'agent_response_complete';
    agent.on(responseCompleteListener, ({ content }) => {
      this._feedback.processAgentEvent('agent_response_complete', { content });
    });
    listeners.add(responseCompleteListener);

    // Tool execution events
    if (this._config.trackToolUsage) {
      const toolStartListener = 'tool_call_start';
      agent.on(toolStartListener, ({ toolName, input, callId }) => {
        this._feedback.processAgentEvent('tool_call_start', { toolName, input, callId });
      });
      listeners.add(toolStartListener);

      const toolCompleteListener = 'tool_call_complete';
      agent.on(toolCompleteListener, ({ toolName, result, callId }) => {
        this._feedback.processAgentEvent('tool_call_complete', { toolName, result, callId });
      });
      listeners.add(toolCompleteListener);
    }

    // State changes
    const stateChangeListener = 'state_change';
    agent.on(stateChangeListener, ({ from, to }) => {
      this._feedback.processAgentEvent('state_change', { from, to });
    });
    listeners.add(stateChangeListener);

    // Error handling
    if (this._config.trackErrors) {
      const errorListener = 'error';
      agent.on(errorListener, ({ error, context }) => {
        this._feedback.processAgentEvent('error', { error, context });
      });
      listeners.add(errorListener);

      const retryListener = 'retry_attempt';
      agent.on(retryListener, ({ attempt, delay, error }) => {
        this._feedback.processAgentEvent('retry_attempt', { attempt, delay, error });
      });
      listeners.add(retryListener);
    }

    // Performance tracking
    if (this._config.trackPerformance) {
      const tokenUsageListener = 'token_usage_update';
      agent.on(tokenUsageListener, ({ usage }) => {
        this._feedback.processAgentEvent('token_usage_update', { usage });
      });
      listeners.add(tokenUsageListener);

      const tokenBudgetListener = 'token_budget_warning';
      agent.on(tokenBudgetListener, ({ message, usage, recommendations }) => {
        this._feedback.processAgentEvent('token_budget_warning', { message, usage, recommendations });
      });
      listeners.add(tokenBudgetListener);
    }

    this._attachedAgents.set(agent, listeners);
    
    logger.info('Agent attached to feedback system', {
      listenersCount: listeners.size,
      listeners: Array.from(listeners)
    });
  }

  // Tool executor integration
  attachToToolExecutor(toolExecutor: ToolExecutor): void {
    if (this._attachedToolExecutors.has(toolExecutor)) {
      logger.warn('ToolExecutor already attached to feedback system');
      return;
    }

    const listeners = new Set<string>();

    // Tool execution events would be handled here
    // Since ToolExecutor doesn't have its own events, we rely on agent events
    
    this._attachedToolExecutors.set(toolExecutor, listeners);
    
    logger.info('ToolExecutor attached to feedback system');
  }

  // Thread manager integration
  attachToThreadManager(threadManager: ThreadManager): void {
    if (this._attachedThreadManagers.has(threadManager)) {
      logger.warn('ThreadManager already attached to feedback system');
      return;
    }

    const listeners = new Set<string>();

    // Thread event processing - ThreadManager doesn't have events, so we'll comment this out
    // const threadEventListener = 'thread_event_added';
    // threadManager.on(threadEventListener, ({ event, threadId }) => {
    //   this._feedback.processEvent(event, { threadId });
    // });
    // listeners.add(threadEventListener);

    // const threadStateListener = 'thread_state_changed';
    // threadManager.on(threadStateListener, ({ threadId, eventType }) => {
    //   this._feedback.processAgentEvent('thread_state_changed', { threadId, eventType });
    // });
    // listeners.add(threadStateListener);

    this._attachedThreadManagers.set(threadManager, listeners);
    
    logger.info('ThreadManager attached to feedback system', {
      listenersCount: listeners.size
    });
  }

  // Detach from systems
  detachFromAgent(agent: Agent): void {
    const listeners = this._attachedAgents.get(agent);
    if (listeners) {
      listeners.forEach(eventName => {
        agent.removeAllListeners(eventName);
      });
      this._attachedAgents.delete(agent);
      logger.info('Agent detached from feedback system');
    }
  }

  detachFromToolExecutor(toolExecutor: ToolExecutor): void {
    const listeners = this._attachedToolExecutors.get(toolExecutor);
    if (listeners) {
      this._attachedToolExecutors.delete(toolExecutor);
      logger.info('ToolExecutor detached from feedback system');
    }
  }

  detachFromThreadManager(threadManager: ThreadManager): void {
    const listeners = this._attachedThreadManagers.get(threadManager);
    if (listeners) {
      // ThreadManager doesn't have event emitters, so just remove from tracking
      this._attachedThreadManagers.delete(threadManager);
      logger.info('ThreadManager detached from feedback system');
    }
  }

  // Convenience method for full integration
  integrateWithSystems(agent: Agent, toolExecutor: ToolExecutor, threadManager: ThreadManager): void {
    this.attachToAgent(agent);
    this.attachToToolExecutor(toolExecutor);
    this.attachToThreadManager(threadManager);
    
    logger.info('Full system integration completed', {
      agentAttached: this._attachedAgents.has(agent),
      toolExecutorAttached: this._attachedToolExecutors.has(toolExecutor),
      threadManagerAttached: this._attachedThreadManagers.has(threadManager)
    });
  }

  // Cleanup
  detachFromAllSystems(): void {
    // Detach from all agents
    for (const agent of this._attachedAgents.keys()) {
      this.detachFromAgent(agent);
    }

    // Detach from all tool executors
    for (const toolExecutor of this._attachedToolExecutors.keys()) {
      this.detachFromToolExecutor(toolExecutor);
    }

    // Detach from all thread managers
    for (const threadManager of this._attachedThreadManagers.keys()) {
      this.detachFromThreadManager(threadManager);
    }

    logger.info('All systems detached from feedback system');
  }

  // Configuration updates
  updateConfig(config: Partial<FeedbackIntegrationConfig>): void {
    this._config = { ...this._config, ...config };
    this._feedback.updateConfig(config);
    
    logger.info('Feedback integration config updated', { config });
  }

  // Status information
  getIntegrationStatus(): {
    attachedAgents: number;
    attachedToolExecutors: number;
    attachedThreadManagers: number;
    currentTurnMetrics: number;
  } {
    return {
      attachedAgents: this._attachedAgents.size,
      attachedToolExecutors: this._attachedToolExecutors.size,
      attachedThreadManagers: this._attachedThreadManagers.size,
      currentTurnMetrics: this._currentTurnMetrics.size
    };
  }

  // Direct access to feedback methods
  generatePerformanceAnalysis() {
    return this._feedback.generatePerformanceAnalysis();
  }

  getFeedbackHistory() {
    return this._feedback.getFeedbackHistory();
  }

  getSessionMetrics(): SessionMetrics {
    return this._feedback.getSessionMetrics();
  }
}