// ABOUTME: Practical examples of helper agent usage patterns
// ABOUTME: Demonstrates real-world integration with infrastructure and session helpers

import { InfrastructureHelper, SessionHelper, HelperRegistry, HelperFactory } from '@lace/core';
import { Agent } from '@lace/core';

/**
 * Example 1: Memory System Integration
 * Infrastructure helper analyzing conversation patterns for memory insights
 */
export class MemoryAnalyzer {
  private registry = new HelperRegistry();

  async analyzeConversationPatterns(conversationLogDir: string): Promise<{
    patterns: string[];
    insights: string;
    recommendations: string[];
  }> {
    const helperId = `memory-analysis-${Date.now()}`;
    
    const helper = this.registry.createInfrastructureHelper(helperId, {
      model: 'smart', // Complex analysis needs smart model
      tools: ['ripgrep-search', 'file-read', 'file-list'],
      workingDirectory: conversationLogDir
    });

    try {
      // Multi-step analysis using helper
      const result = await helper.execute(`
        Analyze conversation logs to identify:
        1. Recurring user question patterns
        2. Common pain points or frustrations
        3. Topics the user frequently returns to
        4. Suggestions for improving assistance
        
        Focus on actionable insights for enhancing user experience.
      `);

      // Parse structured response (would be more sophisticated in practice)
      const patterns = this.extractPatterns(result.content);
      const insights = result.content;
      const recommendations = this.extractRecommendations(result.content);

      return { patterns, insights, recommendations };
    } finally {
      // Clean up helper
      this.registry.removeHelper(helperId);
    }
  }

  private extractPatterns(content: string): string[] {
    // Extract patterns from LLM response
    const patternMatch = content.match(/patterns?[:\s]*(.*?)(?=\n\n|\n[0-9]|$)/is);
    return patternMatch ? patternMatch[1].split('\n').filter(l => l.trim()) : [];
  }

  private extractRecommendations(content: string): string[] {
    // Extract recommendations from LLM response  
    const recMatch = content.match(/recommendations?[:\s]*(.*?)$/is);
    return recMatch ? recMatch[1].split('\n').filter(l => l.trim()) : [];
  }
}

/**
 * Example 2: Enhanced Agent with Helper Integration
 * Agent that uses session helpers for specialized sub-tasks
 */
export class EnhancedAgent extends Agent {
  /**
   * Handle user messages with URL summarization capability
   */
  async handleMessageWithUrlSupport(userMessage: string): Promise<void> {
    // Check if message contains URLs that need summarization
    const urls = this.extractUrls(userMessage);
    
    if (urls.length > 0) {
      // Use session helper for URL processing
      const urlHelper = HelperFactory.createSessionHelper({
        model: 'fast', // URL summarization is typically straightforward
        parentAgent: this
      });

      const summaries: string[] = [];
      
      for (const url of urls) {
        try {
          const result = await urlHelper.execute(
            `Fetch and provide a concise summary of: ${url}`
          );
          summaries.push(`${url}: ${result.content}`);
        } catch (error) {
          summaries.push(`${url}: Unable to fetch (${error})`);
        }
      }

      // Enhance user message with URL context
      const enhancedMessage = `${userMessage}\n\nURL Context:\n${summaries.join('\n')}`;
      await super.handleMessage(enhancedMessage);
    } else {
      // Handle normally
      await super.handleMessage(userMessage);
    }
  }

  /**
   * Analyze complex data using smart model
   */
  async analyzeData(data: string, analysisType: 'financial' | 'technical' | 'general'): Promise<string> {
    const helper = HelperFactory.createSessionHelper({
      model: 'smart', // Complex analysis needs smart model
      parentAgent: this
    });

    const analysisPrompt = this.buildAnalysisPrompt(data, analysisType);
    const result = await helper.execute(analysisPrompt);
    
    return result.content;
  }

  private extractUrls(message: string): string[] {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return message.match(urlRegex) || [];
  }

  private buildAnalysisPrompt(data: string, type: string): string {
    const prompts = {
      financial: 'Analyze this financial data for trends, risks, and opportunities',
      technical: 'Analyze this technical data for patterns, anomalies, and insights', 
      general: 'Analyze this data and provide key insights and recommendations'
    };
    
    return `${prompts[type]}:\n\n${data}`;
  }
}

/**
 * Example 3: Task Management Integration
 * Infrastructure helper for intelligent task creation and management
 */
export class SmartTaskManager {
  async createTasksFromUserRequest(userRequest: string, projectContext?: string): Promise<{
    tasks: Array<{ title: string; description: string; priority: 'high' | 'medium' | 'low' }>;
    summary: string;
  }> {
    const helper = new InfrastructureHelper({
      model: 'fast', // Task breakdown is straightforward
      tools: ['task-create', 'file-read'], // If we need to read project files
      workingDirectory: projectContext
    });

    const prompt = `
      Break down this user request into actionable tasks:
      "${userRequest}"
      
      ${projectContext ? `Project context: ${projectContext}` : ''}
      
      Create specific, measurable tasks with:
      - Clear titles
      - Detailed descriptions
      - Appropriate priority levels
      - Logical sequencing
    `;

    const result = await helper.execute(prompt);

    return {
      tasks: this.parseTasksFromResponse(result.content),
      summary: result.content
    };
  }

  async analyzeProjectProgress(projectDir: string): Promise<{
    completedTasks: number;
    pendingTasks: number;
    blockers: string[];
    recommendations: string[];
  }> {
    const helper = new InfrastructureHelper({
      model: 'smart', // Progress analysis can be complex
      tools: ['file-list', 'file-read', 'ripgrep-search'],
      workingDirectory: projectDir
    });

    const result = await helper.execute(`
      Analyze project progress by examining:
      1. Completed vs pending tasks
      2. Code changes and commits
      3. Documentation updates
      4. Potential blockers or issues
      
      Provide actionable recommendations for moving forward.
    `);

    return this.parseProgressAnalysis(result.content);
  }

  private parseTasksFromResponse(response: string) {
    // Parse structured task response (simplified)
    const tasks: Array<{ title: string; description: string; priority: 'high' | 'medium' | 'low' }> = [];
    
    // Would implement proper parsing of LLM response format
    // This is a simplified example
    const taskBlocks = response.split(/\d+\./);
    
    for (const block of taskBlocks.slice(1)) {
      const lines = block.trim().split('\n');
      const title = lines[0]?.trim() || 'Untitled Task';
      const description = lines.slice(1).join('\n').trim() || title;
      const priority: 'high' | 'medium' | 'low' = 
        block.toLowerCase().includes('urgent') || block.toLowerCase().includes('critical') ? 'high' :
        block.toLowerCase().includes('low') || block.toLowerCase().includes('minor') ? 'low' : 'medium';
      
      tasks.push({ title, description, priority });
    }
    
    return tasks;
  }

  private parseProgressAnalysis(response: string) {
    // Parse progress analysis (simplified implementation)
    return {
      completedTasks: this.extractNumber(response, /completed?[:\s]*(\d+)/i) || 0,
      pendingTasks: this.extractNumber(response, /pending[:\s]*(\d+)/i) || 0,
      blockers: this.extractList(response, 'blockers?'),
      recommendations: this.extractList(response, 'recommendations?')
    };
  }

  private extractNumber(text: string, regex: RegExp): number | null {
    const match = text.match(regex);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractList(text: string, section: string): string[] {
    const regex = new RegExp(`${section}[:\\s]*(.*?)(?=\\n\\n|\\n[a-z]+:|$)`, 'is');
    const match = text.match(regex);
    return match ? match[1].split('\n').map(l => l.trim()).filter(l => l) : [];
  }
}

/**
 * Example 4: Error Analysis System
 * Infrastructure helper for intelligent log analysis and error categorization
 */
export class ErrorAnalysisSystem {
  async analyzeErrorLogs(logDirectory: string, timeframe?: string): Promise<{
    errorCategories: Record<string, number>;
    criticalErrors: string[];
    recommendations: string[];
    trends: string;
  }> {
    const helper = new InfrastructureHelper({
      model: 'smart', // Error analysis requires sophisticated reasoning
      tools: ['file-list', 'file-read', 'ripgrep-search'],
      workingDirectory: logDirectory
    });

    const timeConstraint = timeframe ? `from the last ${timeframe}` : 'recent';
    
    const result = await helper.execute(`
      Analyze error logs ${timeConstraint} to identify:
      
      1. Error categories and frequency
      2. Critical errors requiring immediate attention
      3. Error trends and patterns over time
      4. Recommendations for preventing common errors
      
      Focus on actionable insights for system reliability.
    `);

    return {
      errorCategories: this.parseErrorCategories(result.content),
      criticalErrors: this.extractCriticalErrors(result.content),
      recommendations: this.extractList(result.content, 'recommendations?'),
      trends: this.extractTrends(result.content)
    };
  }

  private parseErrorCategories(content: string): Record<string, number> {
    const categories: Record<string, number> = {};
    
    // Parse error categories from LLM response
    const categoryMatch = content.match(/categories?[:\s]*(.*?)(?=\n\n|critical|recommendations)/is);
    if (categoryMatch) {
      const lines = categoryMatch[1].split('\n');
      for (const line of lines) {
        const match = line.match(/(.+?)[:\s]*(\d+)/);
        if (match) {
          categories[match[1].trim()] = parseInt(match[2], 10);
        }
      }
    }
    
    return categories;
  }

  private extractCriticalErrors(content: string): string[] {
    const criticalMatch = content.match(/critical[:\s]*(.*?)(?=\n\n|recommendations|trends)/is);
    return criticalMatch ? criticalMatch[1].split('\n').filter(l => l.trim()) : [];
  }

  private extractTrends(content: string): string {
    const trendsMatch = content.match(/trends?[:\s]*(.*?)(?=\n\n|$)/is);
    return trendsMatch ? trendsMatch[1].trim() : 'No trend analysis available';
  }

  private extractList(text: string, section: string): string[] {
    const regex = new RegExp(`${section}[:\\s]*(.*?)(?=\\n\\n|\\n[a-z]+:|$)`, 'is');
    const match = text.match(regex);
    return match ? match[1].split('\n').map(l => l.trim()).filter(l => l) : [];
  }
}

/**
 * Example 5: Helper Registry Management
 * Demonstrates centralized helper lifecycle management
 */
export class HelperManager {
  private registry = new HelperRegistry();
  private activeOperations = new Map<string, Promise<any>>();

  /**
   * Start a long-running analysis operation
   */
  async startAnalysis(id: string, type: 'memory' | 'error' | 'performance', context: string): Promise<string> {
    if (this.activeOperations.has(id)) {
      throw new Error(`Analysis ${id} already in progress`);
    }

    const helper = this.registry.createInfrastructureHelper(id, {
      model: 'smart',
      tools: ['file-list', 'file-read', 'ripgrep-search'],
      workingDirectory: context
    });

    const operation = this.executeAnalysis(helper, type);
    this.activeOperations.set(id, operation);

    try {
      const result = await operation;
      return result;
    } finally {
      this.activeOperations.delete(id);
      this.registry.removeHelper(id);
    }
  }

  /**
   * Check status of active operations
   */
  getActiveOperations(): string[] {
    return Array.from(this.activeOperations.keys());
  }

  /**
   * Cancel an operation
   */
  async cancelOperation(id: string): Promise<void> {
    const operation = this.activeOperations.get(id);
    if (operation) {
      // In a real implementation, you'd pass abort signals to helpers
      this.activeOperations.delete(id);
      this.registry.removeHelper(id);
    }
  }

  private async executeAnalysis(helper: InfrastructureHelper, type: string): Promise<string> {
    const prompts = {
      memory: 'Analyze conversation patterns for memory insights',
      error: 'Analyze error logs for critical issues and trends',
      performance: 'Analyze performance metrics and identify bottlenecks'
    };

    const result = await helper.execute(prompts[type as keyof typeof prompts]);
    return result.content;
  }

  /**
   * Cleanup all helpers on shutdown
   */
  async cleanup(): Promise<void> {
    // Wait for active operations to complete
    await Promise.allSettled(Array.from(this.activeOperations.values()));
    
    // Clear registry
    this.registry.clearAll();
    this.activeOperations.clear();
  }
}