// ABOUTME: Interactive console interface for user interaction with agents  
// ABOUTME: Handles input parsing, session management, and output formatting with prompts library

import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

export class Console {
  constructor() {
    this.sessionId = `session-${Date.now()}`;
    this.currentAgent = null;
    this.isProcessing = false;
    this.abortController = null;
    this.history = [];
    this.initializeCommandRegistry();
  }

  initializeCommandRegistry() {
    this.commands = new Map([
      ['/help', {
        description: 'Show help information',
        handler: () => this.showHelp(),
        requiresAgent: false
      }],
      ['/tools', {
        description: 'List available tools',
        handler: () => this.showTools(this.currentAgent),
        requiresAgent: true
      }],
      ['/memory', {
        description: 'Show conversation history',
        handler: () => this.showMemory(this.currentAgent),
        requiresAgent: true,
        async: true
      }],
      ['/status', {
        description: 'Show agent status and context usage',
        handler: () => this.showAgentStatus(this.currentAgent),
        requiresAgent: true
      }],
      ['/approval', {
        description: 'Show tool approval settings',
        handler: () => this.showApprovalStatus(this.currentAgent),
        requiresAgent: true
      }],
      ['/quit', {
        description: 'Exit lace',
        handler: () => 'EXIT_REQUESTED',
        requiresAgent: false
      }],
      ['/exit', {
        description: 'Exit lace',
        handler: () => 'EXIT_REQUESTED',
        requiresAgent: false
      }]
    ]);

    // Parameterized commands
    this.parameterizedCommands = new Map([
      ['/auto-approve', {
        description: 'Add tool to auto-approve list',
        handler: (toolName) => this.manageAutoApproval(this.currentAgent, toolName, true),
        requiresAgent: true,
        parameterDescription: '<tool_name>'
      }],
      ['/deny', {
        description: 'Add tool to deny list', 
        handler: (toolName) => this.manageDenyList(this.currentAgent, toolName, true),
        requiresAgent: true,
        parameterDescription: '<tool_name>'
      }]
    ]);
  }

  async start(agent) {
    this.currentAgent = agent;
    this.history = this.loadHistory();
    
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
          type: 'autocomplete',
          name: 'input',
          message: chalk.green('lace>'),
          choices: this.getCompletions.bind(this),
          suggest: this.suggest.bind(this),
          fallback: { title: 'Continue typing...', value: null }
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
    // Handle simple commands
    if (this.commands.has(input)) {
      const command = this.commands.get(input);
      if (command.requiresAgent && !this.currentAgent) {
        console.log(chalk.red('No agent available'));
        return;
      }
      
      const result = command.async ? await command.handler() : command.handler();
      
      if (result === 'EXIT_REQUESTED') {
        console.log(chalk.yellow('Goodbye!'));
        process.exit(0);
      }
      return;
    }

    // Handle parameterized commands
    for (const [commandPrefix, command] of this.parameterizedCommands) {
      if (input.startsWith(commandPrefix + ' ')) {
        const parameter = input.substring(commandPrefix.length + 1);
        if (command.requiresAgent && !this.currentAgent) {
          console.log(chalk.red('No agent available'));
          return;
        }
        
        if (command.async) {
          await command.handler(parameter);
        } else {
          command.handler(parameter);
        }
        return;
      }
    }

    if (input.startsWith('/')) {
      console.log(chalk.red(`Unknown command: ${input}`));
      console.log(chalk.gray('Type /help for available commands'));
      return;
    }

    if (!input) {
      return;
    }

    // Process user input with agent
    this.isProcessing = true;
    this.abortController = new AbortController();
    
    try {
      const response = await this.currentAgent.processInput(
        this.sessionId, 
        input, 
        { 
          signal: this.abortController.signal,
          onToken: this.handleStreamingToken.bind(this)
        }
      );
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

  // Public methods to expose command registry
  getAvailableCommands() {
    const commands = [];
    
    // Simple commands
    for (const [command, details] of this.commands) {
      commands.push({
        value: command,
        description: details.description,
        type: 'command'
      });
    }
    
    // Parameterized commands
    for (const [command, details] of this.parameterizedCommands) {
      commands.push({
        value: command,
        description: details.description,
        type: 'command',
        hasParameters: true,
        parameterDescription: details.parameterDescription
      });
    }
    
    return commands;
  }

  getCommandCompletions(prefix) {
    const allCommands = this.getAvailableCommands();
    return allCommands.filter(cmd => cmd.value.startsWith('/' + prefix));
  }

  getCompletions(input = '') {
    const completions = [];
    
    // Add history items (reversed to show recent first)
    const historyItems = this.history?.slice().reverse().slice(0, 10) || [];
    
    if (input?.startsWith('/')) {
      // Command completion using registry
      const allCommands = this.getAvailableCommands();
      const matches = allCommands.filter(cmd => cmd.value.startsWith(input));
      completions.push(...matches.map(cmd => ({ 
        title: `${cmd.value} - ${cmd.description}`, 
        value: cmd.value 
      })));
      
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

  showHelp() {
    console.log(chalk.cyan('\nAvailable commands:'));
    console.log('  /help             - Show this help message');
    console.log('  /tools            - List available tools');
    console.log('  /memory           - Show conversation history');
    console.log('  /status           - Show agent status and context usage');
    console.log('  /approval         - Show tool approval settings');
    console.log('  /auto-approve <tool> - Add tool to auto-approve list');
    console.log('  /deny <tool>      - Add tool to deny list');
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