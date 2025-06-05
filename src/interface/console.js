// ABOUTME: Interactive console interface for user interaction with agents
// ABOUTME: Handles input parsing, session management, and output formatting

import inquirer from 'inquirer';
import chalk from 'chalk';

export class Console {
  constructor() {
    this.sessionId = `session-${Date.now()}`;
  }

  async start(agent) {
    console.log(chalk.blue(`Starting session: ${this.sessionId}`));
    console.log(chalk.gray('Type /help for commands, /quit to exit\n'));

    while (true) {
      try {
        const { input } = await inquirer.prompt([
          {
            type: 'input',
            name: 'input',
            message: chalk.green('lace>'),
            prefix: ''
          }
        ]);

        if (input.trim() === '/quit' || input.trim() === '/exit') {
          console.log(chalk.yellow('Goodbye!'));
          break;
        }

        if (input.trim() === '/help') {
          this.showHelp();
          continue;
        }

        if (input.trim() === '/tools') {
          this.showTools(agent);
          continue;
        }

        if (input.trim() === '/memory') {
          await this.showMemory(agent);
          continue;
        }

        if (input.trim() === '/approval') {
          this.showApprovalStatus(agent);
          continue;
        }

        if (input.trim().startsWith('/auto-approve ')) {
          const toolName = input.trim().substring('/auto-approve '.length);
          this.manageAutoApproval(agent, toolName, true);
          continue;
        }

        if (input.trim().startsWith('/deny ')) {
          const toolName = input.trim().substring('/deny '.length);
          this.manageDenyList(agent, toolName, true);
          continue;
        }

        if (input.trim().startsWith('/')) {
          console.log(chalk.red(`Unknown command: ${input.trim()}`));
          continue;
        }

        if (!input.trim()) {
          continue;
        }

        // Process user input with agent
        const response = await agent.processInput(this.sessionId, input.trim());
        this.displayResponse(response);

      } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
    }
  }

  showHelp() {
    console.log(chalk.cyan('\nAvailable commands:'));
    console.log('  /help             - Show this help message');
    console.log('  /tools            - List available tools');
    console.log('  /memory           - Show conversation history');
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