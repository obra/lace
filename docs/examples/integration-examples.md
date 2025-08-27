# Helper Integration Examples

Real-world examples of integrating helper agents into Lace's various systems.

## Memory System Integration

The memory system uses infrastructure helpers to analyze conversation patterns and generate insights.

```typescript
// packages/core/src/memory/conversation-analyzer.ts
import { InfrastructureHelper } from '~/helpers';

export class ConversationAnalyzer {
  async analyzeUserPatterns(userId: string, conversationHistory: string[]): Promise<UserInsights> {
    const helper = new InfrastructureHelper({
      model: 'smart', // Pattern analysis needs sophisticated reasoning
      tools: ['ripgrep-search', 'file-read'], 
      workingDirectory: this.getUserLogDirectory(userId)
    });

    const result = await helper.execute(`
      Analyze conversation patterns for user ${userId}:
      
      1. Identify recurring topics and interests
      2. Note communication preferences and style
      3. Detect any frustration points or confusion
      4. Suggest ways to better assist this user
      
      Base analysis on conversation logs and interaction patterns.
    `);

    return this.parseInsights(result.content);
  }

  private getUserLogDirectory(userId: string): string {
    return path.join(process.env.LACE_DIR!, 'conversations', userId);
  }
}
```

## Agent Tool Enhancement

Agents use session helpers for specialized sub-tasks during conversations.

```typescript
// packages/core/src/agents/enhanced-agent.ts
import { Agent } from '~/agents/agent';
import { SessionHelper } from '~/helpers';

export class WebAwareAgent extends Agent {
  /**
   * Override message handling to add web content processing
   */
  protected async processUserMessage(message: string): Promise<void> {
    const urls = this.extractUrls(message);
    
    if (urls.length > 0) {
      // Use session helper for web content processing
      const webHelper = new SessionHelper({
        model: 'fast',
        parentAgent: this
      });

      const urlSummaries = await Promise.allSettled(
        urls.map(url => 
          webHelper.execute(`Fetch and summarize: ${url}`)
        )
      );

      // Add summaries as context
      const webContext = urlSummaries
        .filter((result): result is PromiseFulfilledResult<any> => 
          result.status === 'fulfilled')
        .map((result, i) => `${urls[i]}: ${result.value.content}`)
        .join('\n\n');

      if (webContext) {
        message += `\n\n=== Web Content Context ===\n${webContext}`;
      }
    }

    // Continue with enhanced message
    await super.processUserMessage(message);
  }

  private extractUrls(text: string): string[] {
    return text.match(/https?:\/\/[^\s]+/g) || [];
  }
}
```

## Task Management Integration

The task system uses infrastructure helpers for intelligent task creation and analysis.

```typescript
// packages/core/src/tasks/smart-task-creator.ts
import { InfrastructureHelper } from '~/helpers';
import { TaskManager } from '~/tasks/task-manager';

export class SmartTaskCreator {
  constructor(private taskManager: TaskManager) {}

  async createTasksFromNaturalLanguage(
    userRequest: string, 
    projectContext?: string
  ): Promise<string[]> {
    const helper = new InfrastructureHelper({
      model: 'fast', // Task breakdown is straightforward
      tools: ['task-create', 'file-read'], // Can read project files for context
      workingDirectory: projectContext
    });

    const result = await helper.execute(`
      Break down this user request into specific, actionable tasks:
      "${userRequest}"
      
      ${projectContext ? `Project context available in current directory.` : ''}
      
      Create tasks that are:
      - Specific and measurable
      - Properly sequenced
      - Realistically scoped
      - Clearly described
    `);

    // Parse task creation results
    const taskIds = this.extractTaskIds(result.toolResults);
    
    return taskIds;
  }

  private extractTaskIds(toolResults: any[]): string[] {
    return toolResults
      .filter(result => result.toolName === 'task-create' && result.status === 'completed')
      .map(result => result.metadata?.taskId)
      .filter(Boolean);
  }
}
```

## Error Analysis System

Infrastructure helpers can analyze system logs and provide intelligent error diagnosis.

```typescript
// packages/core/src/diagnostics/error-analyzer.ts
import { InfrastructureHelper } from '~/helpers';

export class SystemDiagnostics {
  async analyzeSystemHealth(logDirectory: string): Promise<HealthReport> {
    const helper = new InfrastructureHelper({
      model: 'smart', // Error analysis requires sophisticated reasoning  
      tools: ['file-list', 'file-read', 'ripgrep-search'],
      workingDirectory: logDirectory
    });

    const result = await helper.execute(`
      Perform comprehensive system health analysis:
      
      1. Search for error patterns in .log files
      2. Identify critical vs warning level issues  
      3. Analyze error frequency and trends
      4. Check for cascading failure patterns
      5. Recommend immediate actions for critical issues
      
      Prioritize findings by potential impact on system stability.
    `);

    return {
      overallHealth: this.assessOverallHealth(result.content),
      criticalIssues: this.extractCriticalIssues(result.content),
      warnings: this.extractWarnings(result.content),
      recommendations: this.extractRecommendations(result.content),
      analysisTimestamp: new Date(),
      tokensUsed: result.tokenUsage?.totalTokens || 0
    };
  }

  async investigateSpecificError(
    errorMessage: string, 
    logDirectory: string
  ): Promise<ErrorInvestigation> {
    const helper = new InfrastructureHelper({
      model: 'smart',
      tools: ['ripgrep-search', 'file-read'],
      workingDirectory: logDirectory
    });

    const result = await helper.execute(`
      Investigate this specific error: "${errorMessage}"
      
      1. Find all occurrences in log files
      2. Analyze the context around each occurrence
      3. Identify potential root causes
      4. Determine if this is a recurring pattern
      5. Suggest debugging steps and fixes
    `);

    return {
      errorPattern: errorMessage,
      occurrenceCount: this.countOccurrences(result.toolResults),
      rootCauseAnalysis: result.content,
      suggestedFixes: this.extractSuggestedFixes(result.content),
      relatedErrors: this.findRelatedErrors(result.content)
    };
  }

  private assessOverallHealth(content: string): 'healthy' | 'degraded' | 'critical' {
    if (content.toLowerCase().includes('critical') || 
        content.toLowerCase().includes('system failure')) {
      return 'critical';
    }
    if (content.toLowerCase().includes('warning') || 
        content.toLowerCase().includes('degraded')) {
      return 'degraded';
    }
    return 'healthy';
  }

  // Additional parsing methods...
}

interface HealthReport {
  overallHealth: 'healthy' | 'degraded' | 'critical';
  criticalIssues: string[];
  warnings: string[];
  recommendations: string[];
  analysisTimestamp: Date;
  tokensUsed: number;
}

interface ErrorInvestigation {
  errorPattern: string;
  occurrenceCount: number;
  rootCauseAnalysis: string;
  suggestedFixes: string[];
  relatedErrors: string[];
}
```

## CLI Integration

Show how the CLI could use helpers for enhanced user interactions.

```typescript
// packages/cli/src/commands/analyze.ts
import { InfrastructureHelper, HelperRegistry } from '@lace/core';

export class AnalyzeCommand {
  private registry = new HelperRegistry();

  async execute(options: {
    type: 'logs' | 'performance' | 'memory';
    path: string;
    model?: 'fast' | 'smart';
  }): Promise<void> {
    const helperId = `cli-analysis-${Date.now()}`;
    
    try {
      const helper = this.registry.createInfrastructureHelper(helperId, {
        model: options.model || 'smart',
        tools: this.getToolsForAnalysis(options.type),
        workingDirectory: options.path
      });

      console.log(`🔍 Starting ${options.type} analysis...`);
      console.log(`📁 Working directory: ${options.path}`);

      const result = await helper.execute(
        this.getAnalysisPrompt(options.type)
      );

      // Display results
      this.displayResults(result.content, result.tokenUsage);
      
      if (result.toolResults.some(r => r.status === 'failed')) {
        console.warn('⚠️  Some analysis steps encountered issues:');
        result.toolResults
          .filter(r => r.status === 'failed')
          .forEach(r => console.warn(`  - ${r.content[0]?.text || 'Unknown error'}`));
      }

    } finally {
      this.registry.removeHelper(helperId);
    }
  }

  private getToolsForAnalysis(type: string): string[] {
    const toolMap = {
      logs: ['file-list', 'file-read', 'ripgrep-search'],
      performance: ['file-read', 'ripgrep-search'],
      memory: ['file-list', 'file-read', 'ripgrep-search']
    };
    return toolMap[type as keyof typeof toolMap] || ['file-read'];
  }

  private getAnalysisPrompt(type: string): string {
    const prompts = {
      logs: 'Analyze log files for errors, warnings, and patterns. Provide actionable insights.',
      performance: 'Analyze performance metrics and identify bottlenecks or optimization opportunities.',
      memory: 'Analyze memory usage patterns and identify potential memory leaks or inefficiencies.'
    };
    return prompts[type as keyof typeof prompts] || 'Perform general analysis of files.';
  }

  private displayResults(content: string, tokenUsage?: any): void {
    console.log('\n📊 Analysis Results:');
    console.log('='.repeat(50));
    console.log(content);
    
    if (tokenUsage) {
      console.log('\n📈 Resource Usage:');
      console.log(`   Tokens used: ${tokenUsage.totalTokens}`);
      console.log(`   Prompt tokens: ${tokenUsage.promptTokens}`);
      console.log(`   Completion tokens: ${tokenUsage.completionTokens}`);
    }
  }
}
```

## Web Interface Integration

Example of using helpers in the web interface for enhanced functionality.

```typescript
// packages/web/app/lib/server/analysis-service.ts
import { InfrastructureHelper } from '@lace/core';

export class AnalysisService {
  /**
   * Analyze uploaded files using helper agents
   */
  async analyzeUploadedFiles(
    files: File[], 
    analysisType: 'code' | 'data' | 'logs'
  ): Promise<AnalysisResult> {
    // Save files to temp directory
    const tempDir = await this.saveTempFiles(files);
    
    try {
      const helper = new InfrastructureHelper({
        model: 'smart',
        tools: ['file-list', 'file-read', 'ripgrep-search'],
        workingDirectory: tempDir
      });

      const result = await helper.execute(`
        Analyze the uploaded ${analysisType} files:
        
        ${this.getAnalysisInstructions(analysisType)}
        
        Provide a comprehensive analysis with actionable insights.
      `);

      return {
        success: true,
        analysis: result.content,
        filesAnalyzed: files.length,
        toolsUsed: result.toolCalls.length,
        tokensUsed: result.tokenUsage?.totalTokens || 0
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed',
        filesAnalyzed: 0,
        toolsUsed: 0,
        tokensUsed: 0
      };
    } finally {
      // Clean up temp files
      await this.cleanupTempFiles(tempDir);
    }
  }

  private getAnalysisInstructions(type: string): string {
    const instructions = {
      code: 'Review code quality, identify potential bugs, suggest improvements',
      data: 'Analyze data patterns, identify anomalies, provide statistical insights', 
      logs: 'Find error patterns, categorize issues, recommend fixes'
    };
    return instructions[type as keyof typeof instructions] || 'Perform general analysis';
  }

  private async saveTempFiles(files: File[]): Promise<string> {
    // Implementation to save files to temporary directory
    // Return temp directory path
    return '/tmp/analysis-' + Date.now();
  }

  private async cleanupTempFiles(tempDir: string): Promise<void> {
    // Implementation to clean up temporary files
  }
}

interface AnalysisResult {
  success: boolean;
  analysis?: string;
  error?: string;
  filesAnalyzed: number;
  toolsUsed: number;
  tokensUsed: number;
}
```

## Testing Helper Integration

Example of how to test systems that use helpers.

```typescript
// packages/core/src/memory/__tests__/conversation-analyzer.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationAnalyzer } from '../conversation-analyzer';
import { InfrastructureHelper } from '~/helpers';

// Don't mock the helper - test real behavior with controlled inputs
describe('ConversationAnalyzer Integration', () => {
  let analyzer: ConversationAnalyzer;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = await setupTestData();
    analyzer = new ConversationAnalyzer();
  });

  it('should analyze user conversation patterns', async () => {
    // Use real helper with test data
    const insights = await analyzer.analyzeUserPatterns('test-user', []);

    expect(insights).toBeDefined();
    expect(insights.topics).toBeInstanceOf(Array);
    expect(insights.communicationStyle).toBeTypeOf('string');
    expect(insights.recommendations).toBeInstanceOf(Array);
  });

  it('should handle missing log directory gracefully', async () => {
    const nonExistentUser = 'non-existent-user';
    
    await expect(
      analyzer.analyzeUserPatterns(nonExistentUser, [])
    ).rejects.toThrow('User log directory not found');
  });
});

async function setupTestData(): Promise<string> {
  // Create test conversation logs
  const tempDir = '/tmp/test-conversations-' + Date.now();
  // ... setup test data
  return tempDir;
}
```

## Performance Considerations

```typescript
// packages/core/src/helpers/performance-manager.ts
export class HelperPerformanceManager {
  private static readonly MAX_CONCURRENT_HELPERS = 5;
  private static readonly HELPER_TIMEOUT = 60000; // 1 minute
  
  private activeHelpers = new Map<string, { helper: any; startTime: number }>();
  private helperQueue: Array<() => Promise<void>> = [];

  async executeWithLimits<T>(
    helperFactory: () => InfrastructureHelper | SessionHelper,
    task: string
  ): Promise<T> {
    // Wait for slot if needed
    await this.waitForAvailableSlot();

    const helperId = this.generateHelperId();
    const helper = helperFactory();
    const startTime = Date.now();

    this.activeHelpers.set(helperId, { helper, startTime });

    try {
      // Execute with timeout
      const result = await Promise.race([
        helper.execute(task),
        this.createTimeout(HelperPerformanceManager.HELPER_TIMEOUT)
      ]);

      return result as T;
    } finally {
      this.activeHelpers.delete(helperId);
      this.processQueue();
    }
  }

  private async waitForAvailableSlot(): Promise<void> {
    if (this.activeHelpers.size < HelperPerformanceManager.MAX_CONCURRENT_HELPERS) {
      return;
    }

    return new Promise(resolve => {
      this.helperQueue.push(async () => resolve());
    });
  }

  private processQueue(): void {
    if (this.helperQueue.length > 0 && 
        this.activeHelpers.size < HelperPerformanceManager.MAX_CONCURRENT_HELPERS) {
      const next = this.helperQueue.shift();
      if (next) void next();
    }
  }

  private generateHelperId(): string {
    return `helper-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Helper execution timeout')), ms);
    });
  }

  getActiveHelperCount(): number {
    return this.activeHelpers.size;
  }

  getQueueLength(): number {
    return this.helperQueue.length;
  }
}
```