// ABOUTME: Core synthesis engine for processing tool results individually or in batches
// ABOUTME: Handles relationship detection, unified summaries, and fallback strategies

import { TokenEstimator } from "./token-estimator.js";
import { ToolResultExtractor } from "./tool-result-extractor.js";

export class SynthesisEngine {
  constructor(options = {}) {
    this.config = {
      defaultThreshold: 200,
      toolThresholds: {
        shell: 150,
        search: 300,
        file: 250,
        javascript: 200,
        task: 100,
      },
      batchSynthesis: true,
      maxBatchSize: 5,
      ...options,
    };

    this.tokenEstimator = new TokenEstimator();
    this.resultExtractor = new ToolResultExtractor();
  }

  /**
   * Determine if tool results need synthesis
   * @param {Array} toolResults - Array of tool results
   * @param {Array} toolCalls - Corresponding tool calls
   * @returns {Object} Analysis of synthesis needs
   */
  analyzeSynthesisNeeds(toolResults, toolCalls) {
    const needsSynthesis = [];
    const noSynthesis = [];

    for (let i = 0; i < toolResults.length; i++) {
      const toolResult = toolResults[i];
      const toolCall = toolCalls[i];

      if (toolResult.error || toolResult.denied) {
        noSynthesis.push({ result: toolResult, index: i, reason: "error" });
        continue;
      }

      const responseText = this.resultExtractor.extract(toolResult);
      const estimatedTokens = this.tokenEstimator.estimate(responseText);
      const toolName = toolCall.name.split("_")[0];
      const threshold =
        this.config.toolThresholds[toolName] || this.config.defaultThreshold;

      if (estimatedTokens > threshold) {
        needsSynthesis.push({
          result: toolResult,
          call: toolCall,
          index: i,
          tokens: estimatedTokens,
          threshold,
          text: responseText,
        });
      } else {
        noSynthesis.push({
          result: toolResult,
          index: i,
          reason: "under_threshold",
        });
      }
    }

    return {
      needsSynthesis,
      noSynthesis,
      shouldUseBatch: this.config.batchSynthesis && needsSynthesis.length > 1,
      totalTokens: needsSynthesis.reduce((sum, item) => sum + item.tokens, 0),
    };
  }

  /**
   * Process tool results for synthesis in optimal batches
   * @param {Array} toolResults - Tool results
   * @param {Array} toolCalls - Tool calls
   * @param {Function} synthesisFunction - Function to call for actual synthesis
   * @returns {Array} Processed results
   */
  async processSynthesis(toolResults, toolCalls, synthesisFunction) {
    if (!toolResults || toolResults.length === 0) {
      return toolResults;
    }

    const analysis = this.analyzeSynthesisNeeds(toolResults, toolCalls);

    if (analysis.needsSynthesis.length === 0) {
      return toolResults; // Nothing to synthesize
    }

    const synthesizedResults = [...toolResults]; // Copy original array

    if (analysis.shouldUseBatch) {
      await this.processBatchSynthesis(
        analysis.needsSynthesis,
        synthesizedResults,
        synthesisFunction,
      );
    } else {
      await this.processIndividualSynthesis(
        analysis.needsSynthesis,
        synthesizedResults,
        synthesisFunction,
      );
    }

    return synthesizedResults;
  }

  /**
   * Process synthesis in batches for efficiency
   * @param {Array} needsSynthesis - Items needing synthesis
   * @param {Array} synthesizedResults - Results array to update
   * @param {Function} synthesisFunction - Synthesis function
   */
  async processBatchSynthesis(
    needsSynthesis,
    synthesizedResults,
    synthesisFunction,
  ) {
    const batchSize = Math.min(needsSynthesis.length, this.config.maxBatchSize);

    for (let i = 0; i < needsSynthesis.length; i += batchSize) {
      const batch = needsSynthesis.slice(i, i + batchSize);

      if (batch.length === 1) {
        // Single item - use individual synthesis
        const item = batch[0];
        const synthesized = await synthesisFunction.individual(
          item.result,
          item.call,
        );
        synthesizedResults[item.index] = synthesized;
      } else {
        // Multiple items - use batch synthesis
        try {
          const batchSynthesized = await synthesisFunction.batch(batch);
          for (let j = 0; j < batch.length; j++) {
            synthesizedResults[batch[j].index] = batchSynthesized[j];
          }
        } catch (error) {
          // Fallback to individual synthesis
          for (const item of batch) {
            const synthesized = await synthesisFunction.individual(
              item.result,
              item.call,
            );
            synthesizedResults[item.index] = synthesized;
          }
        }
      }
    }
  }

  /**
   * Process each item individually
   * @param {Array} needsSynthesis - Items needing synthesis
   * @param {Array} synthesizedResults - Results array to update
   * @param {Function} synthesisFunction - Synthesis function
   */
  async processIndividualSynthesis(
    needsSynthesis,
    synthesizedResults,
    synthesisFunction,
  ) {
    for (const item of needsSynthesis) {
      const synthesized = await synthesisFunction.individual(
        item.result,
        item.call,
      );
      synthesizedResults[item.index] = synthesized;
    }
  }

  /**
   * Create batch synthesis prompt with relationship analysis
   * @param {Array} toolBatch - Batch of tools to synthesize
   * @param {string} basePrompt - Base synthesis prompt
   * @returns {string} Enhanced batch prompt
   */
  createBatchPrompt(toolBatch, basePrompt) {
    const relationships = this.analyzeRelationships(toolBatch);
    const totalTokens = toolBatch.reduce((sum, item) => sum + item.tokens, 0);

    let toolSummaries = "";
    toolBatch.forEach((item, index) => {
      toolSummaries += `\n\n--- Tool ${index + 1}: ${item.call.name} ---\n`;
      toolSummaries += `Arguments: ${JSON.stringify(item.call.input, null, 2)}\n`;
      toolSummaries += `Result (${item.tokens} tokens):\n${item.text}`;
    });

    return `${basePrompt}

BATCH SYNTHESIS CONTEXT:
- Processing ${toolBatch.length} tools executed in parallel
- Total content: ~${totalTokens} tokens
- Detected relationships: ${relationships.summary}

ANALYSIS PRIORITIES:
1. Relationships and dependencies between results
2. Common themes or patterns across tools
3. Essential information that must be preserved
4. Any conflicts or inconsistencies between results
5. Workflow implications and next steps

PARALLEL TOOL RESULTS:${toolSummaries}

Please provide a synthesized summary for each tool, maintaining their individual identity while noting relationships. Return as a JSON array with ${toolBatch.length} summaries in the same order.`;
  }

  /**
   * Analyze relationships between tool results in a batch
   * @param {Array} toolBatch - Batch of tools
   * @returns {Object} Relationship analysis
   */
  analyzeRelationships(toolBatch) {
    const toolNames = toolBatch.map((item) => item.call.name.split("_")[0]);
    const uniqueTools = [...new Set(toolNames)];

    // Detect common patterns
    const hasFileOps = toolNames.some((name) => name === "file");
    const hasShellOps = toolNames.some((name) => name === "shell");
    const hasSearchOps = toolNames.some((name) => name === "search");
    const hasTaskOps = toolNames.some((name) => name === "task");

    let summary = "Independent operations";

    if (hasFileOps && hasShellOps) {
      summary = "File system and shell workflow";
    } else if (hasSearchOps && hasFileOps) {
      summary = "Search and file processing workflow";
    } else if (hasTaskOps) {
      summary = "Task orchestration workflow";
    } else if (uniqueTools.length === 1) {
      summary = `Multiple ${uniqueTools[0]} operations`;
    }

    return {
      summary,
      toolTypes: uniqueTools,
      hasWorkflow: hasFileOps || hasShellOps || hasTaskOps,
      complexity: toolBatch.length > 3 ? "high" : "medium",
    };
  }

  /**
   * Parse batch synthesis response with fallback strategies
   * @param {string} content - Raw synthesis response
   * @param {number} expectedCount - Expected number of summaries
   * @returns {Array} Parsed summaries
   */
  parseBatchSynthesis(content, expectedCount) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length === expectedCount) {
        return parsed;
      }
    } catch (error) {
      // JSON parsing failed, use fallback
    }

    return this.fallbackParseBatchSynthesis(content, expectedCount);
  }

  /**
   * Fallback parsing when JSON parsing fails
   * @param {string} content - Content to parse
   * @param {number} expectedCount - Expected number of sections
   * @returns {Array} Parsed sections
   */
  fallbackParseBatchSynthesis(content, expectedCount) {
    // Try to split by common delimiters
    const delimiters = [/---\s*Tool\s*\d+/gi, /\d+\.\s*/g, /\n\s*\n/g];

    for (const delimiter of delimiters) {
      const sections = content
        .split(delimiter)
        .filter((s) => s.trim().length > 0);
      if (sections.length >= expectedCount) {
        return sections.slice(0, expectedCount);
      }
    }

    // Final fallback: split into equal parts
    const avgLength = Math.floor(content.length / expectedCount);
    const summaries = [];

    for (let i = 0; i < expectedCount; i++) {
      const start = i * avgLength;
      const end =
        i === expectedCount - 1 ? content.length : (i + 1) * avgLength;
      summaries.push(
        content.slice(start, end).trim() ||
          `Tool ${i + 1} synthesis unavailable`,
      );
    }

    return summaries;
  }

  /**
   * Get synthesis statistics for monitoring and optimization
   * @param {Array} toolResults - Original results
   * @param {Array} synthesizedResults - Processed results
   * @returns {Object} Synthesis statistics
   */
  getSynthesisStats(toolResults, synthesizedResults) {
    const original = this.resultExtractor.analyzeResults(toolResults);
    const synthesized = synthesizedResults.filter((r) => r.synthesized);

    return {
      originalCount: toolResults.length,
      synthesizedCount: synthesized.length,
      batchSynthesized: synthesized.filter((r) => r.batchSynthesized).length,
      tokenReduction: this.calculateTokenReduction(
        toolResults,
        synthesizedResults,
      ),
      processingEfficiency: synthesized.length / toolResults.length,
    };
  }

  /**
   * Calculate token reduction achieved by synthesis
   * @param {Array} original - Original results
   * @param {Array} synthesized - Synthesized results
   * @returns {Object} Token reduction metrics
   */
  calculateTokenReduction(original, synthesized) {
    const originalTexts = this.resultExtractor.extractBatch(original);
    const synthesizedTexts = synthesized.map((r) =>
      r.synthesized
        ? r.summary || this.resultExtractor.extract(r)
        : this.resultExtractor.extract(r),
    );

    const originalTokens = this.tokenEstimator.estimateTotal(originalTexts);
    const synthesizedTokens =
      this.tokenEstimator.estimateTotal(synthesizedTexts);

    return {
      originalTokens,
      synthesizedTokens,
      reduction: originalTokens - synthesizedTokens,
      reductionPercent:
        originalTokens > 0
          ? ((originalTokens - synthesizedTokens) / originalTokens) * 100
          : 0,
    };
  }
}
