// ABOUTME: Interactive console interface for user interaction with agents  
// ABOUTME: Handles input parsing, session management, and output formatting with prompts library

import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import open from 'open';
import { ActivityLogger } from '../logging/activity-logger.js';

export class Console {
  constructor(options = {}) {
    this.sessionId = `session-${Date.now()}`;
    this.currentAgent = null;
    this.isProcessing = false;
    this.abortController = null;
    this.history = [];
    this.activityLogger = options.activityLogger || new ActivityLogger();
    this.webServer = options.webServer || null;
  }

  async start(agent) {
    this.currentAgent = agent;
    this.history = this.loadHistory();
    
    // Initialize activity logger
    await this.activityLogger.initialize();
    
    console.log(chalk.blue(`Starting session: ${this.sessionId}`));
    console.log(chalk.gray('Type /help for commands, /quit to exit'));
    console.log(chalk.gray('Use Tab for completion, Ctrl+C to interrupt, Up/Down for history\n'));

    // Configure prompts for interrupt handling
    prompts.override({
      onCancel: () => {
        if (this.isProcessing && this.abortController) {
          console.log(chalk.yellow('\n⚠️  Aborting inference...'));
          this.abortController.abort();
          this.isProcessing = false;
          return false; // Continue prompting
        } else {
          console.log(chalk.yellow('\nUse /quit to exit'));
          return false; // Continue prompting
        }
      }
    });

    // Main input loop
    while (true) {
      try {
        const response = await prompts({
          type: 'text',
          name: 'input',
          message: chalk.green('lace>')
        });

        // Handle Ctrl+C or empty input
        if (response.input === undefined) {
          continue;
        }

        const input = response.input.trim();
        
        // Save to history
        if (input && !this.history.includes(input)) {
          this.history.push(input);
          this.saveHistory(input);
        }

        if (input === '/quit' || input === '/exit') {
          console.log(chalk.yellow('Goodbye!'));
          break;
        }

        await this.handleInput(input);

      } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    }
  }

  async handleInput(input) {
    if (input === '/help') {
      this.showHelp();
      return;
    }

    if (input === '/tools') {
      this.showTools(this.currentAgent);
      return;
    }

    if (input === '/memory') {
      await this.showMemory(this.currentAgent);
      return;
    }

    if (input === '/approval') {
      this.showApprovalStatus(this.currentAgent);
      return;
    }

    if (input === '/status') {
      this.showAgentStatus(this.currentAgent);
      return;
    }

    if (input.startsWith('/auto-approve ')) {
      const toolName = input.substring('/auto-approve '.length);
      this.manageAutoApproval(this.currentAgent, toolName, true);
      return;
    }

    if (input.startsWith('/deny ')) {
      const toolName = input.substring('/deny '.length);
      this.manageDenyList(this.currentAgent, toolName, true);
      return;
    }

    if (input === '/web') {
      await this.openWebCompanion();
      return;
    }

    if (input.startsWith('/')) {
      console.log(chalk.red(`Unknown command: ${input}`));
      return;
    }

    if (!input) {
      return;
    }

    // Log user input event
    await this.activityLogger.logEvent('user_input', this.sessionId, null, {
      content: input,
      timestamp: new Date().toISOString()
    });

    // Process user input with agent
    this.isProcessing = true;
    this.abortController = new AbortController();
    const startTime = Date.now();
    
    try {
      const response = await this.currentAgent.processInput(
        this.sessionId, 
        input, 
        { 
          signal: this.abortController.signal,
          onToken: this.handleStreamingToken.bind(this)
        }
      );
      
      // Log agent response event
      const duration = Date.now() - startTime;
      await this.activityLogger.logEvent('agent_response', this.sessionId, null, {
        content: response.content || '',
        tokens: response.usage?.total_tokens || response.usage?.output_tokens || 0,
        duration_ms: duration
      });
      
      this.displayResponse(response);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(chalk.yellow('Operation was aborted.'));
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  handleStreamingToken(token) {
    // Write token directly to stdout without newline
    process.stdout.write(token);
  }

  getCompletions(input = '') {
    const completions = [];
    
    // Command completions
    const commands = [
      '/help', '/tools', '/memory', '/status', '/approval', 
      '/auto-approve', '/deny', '/quit', '/exit'
    ];
    
    // Add history items (reversed to show recent first)
    const historyItems = this.history?.slice().reverse().slice(0, 10) || [];
    
    if (input?.startsWith('/')) {
      // Command completion
      const matches = commands.filter(cmd => cmd.startsWith(input));
      completions.push(...matches.map(cmd => ({ title: cmd, value: cmd })));
      
      // Tool name completion for /auto-approve and /deny
      if (input.startsWith('/auto-approve ') || input.startsWith('/deny ')) {
        const prefix = input.startsWith('/auto-approve ') ? '/auto-approve ' : '/deny ';
        const partial = input.substring(prefix.length);
        const tools = this.currentAgent?.tools?.listTools() || [];
        const toolMatches = tools
          .filter(tool => tool?.startsWith(partial))
          .map(tool => ({ title: prefix + tool, value: prefix + tool }));
        completions.push(...toolMatches);
      }
    } else {
      // File path completion
      const pathCompletions = this.getFileCompletions(input);
      completions.push(...pathCompletions.map(path => ({ title: path, value: path })));
      
      // History completion
      const historyMatches = historyItems
        .filter(item => item?.toLowerCase().includes(input?.toLowerCase() || ''))
        .slice(0, 5)
        .map(item => ({ title: `${item} (history)`, value: item }));
      completions.push(...historyMatches);
    }
    
    return completions;
  }

  suggest(input = '', choices = []) {
    return choices.filter(choice => 
      choice?.title?.toLowerCase().includes(input?.toLowerCase() || '')
    );
  }

  getFileCompletions(partial = '') {
    try {
      const dir = partial?.includes('/') ? path.dirname(partial) : '.';
      const base = path.basename(partial);
      
      if (!fs.existsSync(dir)) {
        return [];
      }
      
      const files = fs.readdirSync(dir);
      return files
        .filter(file => file?.startsWith(base))
        .map(file => {
          const fullPath = path.join(dir, file);
          const isDir = fs.statSync(fullPath).isDirectory();
          return isDir ? fullPath + '/' : fullPath;
        });
    } catch (error) {
      return [];
    }
  }

  loadHistory() {
    try {
      const laceDir = path.join(process.cwd(), '.lace');
      const historyPath = path.join(laceDir, 'history');
      
      if (fs.existsSync(historyPath)) {
        return fs.readFileSync(historyPath, 'utf8')
          .split('\n')
          .filter(line => line.trim())
          .slice(-1000); // Keep last 1000 entries
      }
    } catch (error) {
      // Ignore history loading errors
    }
    return [];
  }

  saveHistory(input) {
    if (!input.trim()) return;
    
    try {
      const laceDir = path.join(process.cwd(), '.lace');
      if (!fs.existsSync(laceDir)) {
        fs.mkdirSync(laceDir, { recursive: true });
      }
      
      const historyPath = path.join(laceDir, 'history');
      fs.appendFileSync(historyPath, input + '\n');
    } catch (error) {
      // Ignore history saving errors
    }
  }

  async openWebCompanion() {
    if (!this.webServer) {
      console.log(chalk.yellow('Web companion is not enabled. Use --web flag to start with web interface.'));
      return;
    }

    const status = this.webServer.getStatus();
    if (!status.isStarted) {
      console.log(chalk.yellow('Web server is not running. Cannot open web companion.'));
      return;
    }

    const url = status.url;
    console.log(chalk.blue(`🌐 Opening web companion at ${url}`));
    
    try {
      await open(url);
      console.log(chalk.green('✅ Web companion opened in your default browser'));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to open browser: ${error.message}`));
      console.log(chalk.gray(`You can manually open: ${url}`));
    }
  }

  showHelp() {
    console.log(chalk.cyan('\nAvailable commands:'));
    console.log('  /help             - Show this help message');
    console.log('  /tools            - List available tools');
    console.log('  /memory           - Show conversation history');
    console.log('  /status           - Show agent status and context usage');
    console.log('  /approval         - Show tool approval settings');
    console.log('  /auto-approve <tool> - Add tool to auto-approve list');
    console.log('  /deny <tool>      - Add tool to deny list');
    if (this.webServer) {
      console.log('  /web              - Open web companion in browser');
    }
    console.log('  /quit             - Exit lace\n');
  }

  showTools(agent) {
    console.log(chalk.cyan('\nAvailable tools:'));
    const tools = agent.tools.listTools();
    for (const tool of tools) {
      const schema = agent.tools.getToolSchema(tool);
      console.log(`  ${chalk.yellow(tool)} - ${schema?.description || 'No description'}`);
    }
    console.log();
  }

  async showMemory(agent) {
    console.log(chalk.cyan('\nRecent conversation history:'));
    const history = await agent.getConversationHistory(this.sessionId, 5);
    
    for (const entry of history.reverse()) {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      const roleColor = entry.role === 'user' ? chalk.green : chalk.blue;
      console.log(`${chalk.gray(timestamp)} ${roleColor(entry.role)}: ${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}`);
    }
    console.log();
  }

  showAgentStatus(agent) {
    console.log(chalk.cyan('\nAgent Status:'));
    console.log(`  Role: ${chalk.yellow(agent.role)}`);
    console.log(`  Model: ${chalk.yellow(agent.assignedModel)}`);
    console.log(`  Provider: ${chalk.yellow(agent.assignedProvider)}`);
    console.log(`  Generation: ${chalk.yellow(agent.generation)}`);
    
    // Context window information
    const contextUsage = agent.calculateContextUsage(agent.contextSize);
    const contextColor = contextUsage.percentage > 80 ? chalk.red : 
                        contextUsage.percentage > 60 ? chalk.yellow : chalk.green;
    
    console.log(chalk.cyan('\nContext Window Usage:'));
    console.log(`  Used: ${chalk.white(contextUsage.used.toLocaleString())} tokens`);
    console.log(`  Total: ${chalk.white(contextUsage.total.toLocaleString())} tokens`);
    console.log(`  Usage: ${contextColor(contextUsage.percentage.toFixed(1) + '%')}`);
    console.log(`  Remaining: ${chalk.white(contextUsage.remaining.toLocaleString())} tokens`);
    
    if (contextUsage.percentage > agent.handoffThreshold * 100) {
      console.log(chalk.red('  ⚠️ Context approaching handoff threshold!'));
    }

    // Model pricing info if available
    if (agent.modelProvider && agent.assignedProvider === 'anthropic') {
      const provider = agent.modelProvider.getProvider(agent.assignedProvider);
      const modelInfo = provider.modelInfo[agent.assignedModel];
      if (modelInfo) {
        console.log(chalk.cyan('\nModel Pricing:'));
        console.log(`  Input: $${modelInfo.inputPricePerMillion.toFixed(2)} per million tokens`);
        console.log(`  Output: $${modelInfo.outputPricePerMillion.toFixed(2)} per million tokens`);
        
        // Estimate cost for current context
        if (agent.contextSize > 0) {
          const estimatedCost = (agent.contextSize / 1000000) * modelInfo.inputPricePerMillion;
          console.log(`  Current context cost: ~$${estimatedCost.toFixed(4)}`);
        }
      }
    }
    
    console.log();
  }

  displayResponse(response) {
    if (response.error) {
      console.log(chalk.red(`Error: ${response.error}`));
      return;
    }

    if (response.content) {
      console.log(chalk.white(response.content));
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(chalk.gray('\nTool calls executed:'));
      for (const call of response.toolCalls) {
        const params = call.input || call.params || {};
        const paramsStr = JSON.stringify(params);
        const truncated = paramsStr.length > 50 ? paramsStr.substring(0, 50) + '...' : paramsStr;
        console.log(chalk.gray(`  ${call.name}(${truncated})`));
      }
    }

    if (response.toolResults && response.toolResults.length > 0) {
      console.log(chalk.cyan('\nTool results:'));
      for (const result of response.toolResults) {
        if (result.denied) {
          console.log(chalk.red(`  🚫 ${result.toolCall.name}: ${result.error}`));
        } else if (result.error) {
          console.log(chalk.red(`  ❌ ${result.toolCall.name}: ${result.error}`));
        } else {
          const approvalIcon = result.approved ? '✅' : '⚠️';
          console.log(chalk.green(`  ${approvalIcon} ${result.toolCall.name}: Success`));
        }
      }
    }

    console.log();
  }

  showApprovalStatus(agent) {
    if (!agent.toolApproval) {
      console.log(chalk.yellow('\nTool approval system not enabled'));
      return;
    }

    const status = agent.toolApproval.getStatus();
    console.log(chalk.cyan('\nTool Approval Settings:'));
    console.log(`  Interactive mode: ${status.interactive ? chalk.green('Enabled') : chalk.red('Disabled')}`);
    
    if (status.autoApprove.length > 0) {
      console.log(chalk.green('\n  Auto-approve tools:'));
      for (const tool of status.autoApprove) {
        console.log(`    ✅ ${tool}`);
      }
    }
    
    if (status.denyList.length > 0) {
      console.log(chalk.red('\n  Denied tools:'));
      for (const tool of status.denyList) {
        console.log(`    🚫 ${tool}`);
      }
    }
    
    console.log();
  }

  manageAutoApproval(agent, toolName, add) {
    if (!agent.toolApproval) {
      console.log(chalk.yellow('Tool approval system not enabled'));
      return;
    }

    if (add) {
      agent.toolApproval.addAutoApprove(toolName);
      console.log(chalk.green(`✅ Added '${toolName}' to auto-approve list`));
    } else {
      agent.toolApproval.removeAutoApprove(toolName);
      console.log(chalk.yellow(`Removed '${toolName}' from auto-approve list`));
    }
  }

  manageDenyList(agent, toolName, add) {
    if (!agent.toolApproval) {
      console.log(chalk.yellow('Tool approval system not enabled'));
      return;
    }

    if (add) {
      agent.toolApproval.addDenyList(toolName);
      console.log(chalk.red(`🚫 Added '${toolName}' to deny list`));
    } else {
      agent.toolApproval.removeDenyList(toolName);
      console.log(chalk.yellow(`Removed '${toolName}' from deny list`));
    }
  }
}