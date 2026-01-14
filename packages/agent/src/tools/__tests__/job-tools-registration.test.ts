// ABOUTME: Tests that job management tools are registered in ToolExecutor

import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../executor';

describe('ToolExecutor job tools registration', () => {
  it('registers job management tools', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const toolNames = executor.getAvailableToolNames();

    expect(toolNames).toContain('job_output');
    expect(toolNames).toContain('jobs_list');
    expect(toolNames).toContain('job_kill');
  });

  it('retrieves job_output tool by name', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const tool = executor.getTool('job_output');

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('job_output');
    expect(tool?.description).toContain('Get status and output from a background job');
  });

  it('retrieves jobs_list tool by name', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const tool = executor.getTool('jobs_list');

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('jobs_list');
    expect(tool?.description).toContain('List all background jobs in the current session');
  });

  it('retrieves job_kill tool by name', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const tool = executor.getTool('job_kill');

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('job_kill');
    expect(tool?.description).toContain('Cancel a running background job');
  });

  it('job tools have correct annotations', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();

    // All job management tools are safeInternal - they're pure internal control
    // flow that doesn't interact with the filesystem or external systems
    const jobOutputTool = executor.getTool('job_output');
    expect(jobOutputTool?.annotations?.safeInternal).toBe(true);
    expect(jobOutputTool?.annotations?.readOnlySafe).toBe(true);

    const jobsListTool = executor.getTool('jobs_list');
    expect(jobsListTool?.annotations?.safeInternal).toBe(true);
    expect(jobsListTool?.annotations?.readOnlySafe).toBe(true);

    const jobKillTool = executor.getTool('job_kill');
    expect(jobKillTool?.annotations?.safeInternal).toBe(true);
  });
});
