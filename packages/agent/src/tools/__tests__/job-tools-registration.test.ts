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
    expect(tool?.description).toContain('Retrieve status and output from a background job');
  });

  it('retrieves jobs_list tool by name', () => {
    const executor = new ToolExecutor();
    executor.registerAllAvailableTools();
    const tool = executor.getTool('jobs_list');

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('jobs_list');
    expect(tool?.description).toContain('List current and recent background jobs');
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

    const jobOutputTool = executor.getTool('job_output');
    expect(jobOutputTool?.annotations?.readOnlySafe).toBe(true);
    expect(jobOutputTool?.annotations?.destructiveHint).toBe(false);

    const jobsListTool = executor.getTool('jobs_list');
    expect(jobsListTool?.annotations?.readOnlySafe).toBe(true);
    expect(jobsListTool?.annotations?.destructiveHint).toBe(false);

    const jobKillTool = executor.getTool('job_kill');
    expect(jobKillTool?.annotations?.readOnlySafe).toBe(false);
    expect(jobKillTool?.annotations?.destructiveHint).toBe(true);
  });
});
