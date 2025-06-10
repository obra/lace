// ABOUTME: Comprehensive unit tests for TaskTool agent orchestration functionality
// ABOUTME: Tests all methods, error cases, and integration with agent context

import { test, describe, beforeEach, afterEach, TestHarness, assert, utils } from '../../test-harness.js'
import { TaskTool } from '../../../src/tools/task-tool.js'
import { jest } from '@jest/globals'

describe('TaskTool', () => {
  let harness
  let taskTool
  let mockAgent
  let mockProgressTracker

  beforeEach(async () => {
    harness = new TestHarness()

    // Create TaskTool instance
    taskTool = new TaskTool()

    // Create mock progress tracker
    mockProgressTracker = {
      updateProgress: async (agentId, progressData) => {
        mockProgressTracker.lastUpdate = { agentId, progressData }
        return { success: true }
      },
      lastUpdate: null
    }

    // Create mock agent
    mockAgent = {
      generation: 1.1,
      delegateTask: async (sessionId, description, options) => {
        return {
          content: `Task completed: ${description}`,
          metadata: options
        }
      },
      spawnSubagent: async (options) => {
        const mockSubagent = {
          generation: 1.2,
          generateResponse: async (sessionId, task) => {
            return {
              content: `Subagent response: ${task}`,
              metadata: { sessionId, task }
            }
          }
        }
        return mockSubagent
      }
    }
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  describe('Initialization', () => {
    test('should create TaskTool instance', async () => {
      assert.ok(taskTool instanceof Object, 'TaskTool should be created')
      assert.equal(typeof taskTool.delegateTask, 'function', 'Should have delegateTask method')
      assert.equal(typeof taskTool.spawnAgent, 'function', 'Should have spawnAgent method')
      assert.equal(typeof taskTool.reportProgress, 'function', 'Should have reportProgress method')
      assert.equal(typeof taskTool.requestHelp, 'function', 'Should have requestHelp method')
    })

    test('should have proper schema', async () => {
      const schema = taskTool.getSchema()

      assert.equal(schema.name, 'task', 'Schema name should be "task"')
      assert.ok(schema.description, 'Schema should have description')
      assert.ok(schema.methods, 'Schema should have methods')

      // Check all required methods exist in schema
      assert.ok(schema.methods.delegateTask, 'Schema should include delegateTask')
      assert.ok(schema.methods.spawnAgent, 'Schema should include spawnAgent')
      assert.ok(schema.methods.reportProgress, 'Schema should include reportProgress')
      assert.ok(schema.methods.requestHelp, 'Schema should include requestHelp')
    })

    test('should set agent context correctly', async () => {
      taskTool.setAgent(mockAgent)
      assert.equal(taskTool.agent, mockAgent, 'Agent should be set correctly')
    })

    test('should set session ID correctly', async () => {
      const sessionId = 'test-session-123'
      taskTool.setSessionId(sessionId)
      assert.equal(taskTool.currentSessionId, sessionId, 'Session ID should be set correctly')
    })

    test('should set progress tracker correctly', async () => {
      taskTool.setProgressTracker(mockProgressTracker)
      assert.equal(taskTool.progressTracker, mockProgressTracker, 'Progress tracker should be set correctly')
    })
  })

  describe('delegateTask', () => {
    beforeEach(() => {
      taskTool.setAgent(mockAgent)
      taskTool.setSessionId('test-session')
      taskTool.setProgressTracker(mockProgressTracker)
    })

    test('should delegate task successfully with defaults', async () => {
      const params = {
        description: 'Test task description'
      }

      const result = await taskTool.delegateTask(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.ok(result.result, 'Should have result')
      assert.equal(result.metadata.role, 'general', 'Should use default role')
      assert.equal(result.metadata.model, 'claude-3-5-sonnet-20241022', 'Should use default model')
    })

    test('should delegate task with custom options', async () => {
      const params = {
        description: 'Custom task',
        role: 'reasoning',
        model: 'claude-3-5-haiku-20241022',
        provider: 'anthropic',
        capabilities: ['analysis', 'research'],
        timeout: 60000
      }

      const result = await taskTool.delegateTask(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.equal(result.metadata.role, 'reasoning', 'Should use custom role')
      assert.equal(result.metadata.model, 'claude-3-5-haiku-20241022', 'Should use custom model')
      assert.equal(result.metadata.provider, 'anthropic', 'Should use custom provider')
    })

    test('should report progress on completion', async () => {
      const params = {
        description: 'Task with progress tracking'
      }

      await taskTool.delegateTask(params)

      assert.ok(mockProgressTracker.lastUpdate, 'Should have updated progress')
      assert.equal(mockProgressTracker.lastUpdate.agentId, 1.1, 'Should track correct agent ID')
      assert.equal(mockProgressTracker.lastUpdate.progressData.status, 'completed', 'Should report completed status')
      assert.equal(mockProgressTracker.lastUpdate.progressData.progressPercent, 100, 'Should report 100% progress')
    })

    test('should fail without description', async () => {
      const params = {}

      const result = await taskTool.delegateTask(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('description'), 'Error should mention missing description')
    })

    test('should fail without agent context', async () => {
      taskTool.setAgent(null)
      const params = {
        description: 'Test task'
      }

      const result = await taskTool.delegateTask(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('agent context'), 'Error should mention missing agent context')
    })

    test('should handle timeout', async () => {
      // Mock agent that takes too long
      const slowAgent = {
        ...mockAgent,
        delegateTask: async () => {
          await new Promise(resolve => setTimeout(resolve, 1000))
          return { content: 'Should not reach here' }
        }
      }

      taskTool.setAgent(slowAgent)

      const params = {
        description: 'Slow task',
        timeout: 100 // 100ms timeout
      }

      const result = await taskTool.delegateTask(params)

      assert.equal(result.success, false, 'Should fail due to timeout')
      assert.ok(result.error.includes('timed out'), 'Error should mention timeout')
    })

    test('should handle agent errors', async () => {
      // Mock agent that throws error
      const errorAgent = {
        ...mockAgent,
        delegateTask: async () => {
          throw new Error('Agent delegation failed')
        }
      }

      taskTool.setAgent(errorAgent)

      const params = {
        description: 'Failing task'
      }

      const result = await taskTool.delegateTask(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('Agent delegation failed'), 'Should include original error message')
    })
  })

  describe('spawnAgent', () => {
    beforeEach(() => {
      taskTool.setAgent(mockAgent)
      taskTool.setSessionId('test-session')
    })

    test('should spawn agent successfully', async () => {
      const params = {
        role: 'execution',
        task: 'Write a function',
        model: 'claude-3-5-sonnet-20241022',
        capabilities: ['coding', 'testing']
      }

      const result = await taskTool.spawnAgent(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.equal(result.agentId, 1.2, 'Should return correct agent ID')
      assert.ok(result.result, 'Should have result')
      assert.equal(result.metadata.role, 'execution', 'Should use specified role')
    })

    test('should use default values', async () => {
      const params = {
        role: 'reasoning',
        task: 'Analyze data'
      }

      const result = await taskTool.spawnAgent(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.equal(result.metadata.model, 'claude-3-5-sonnet-20241022', 'Should use default model')
      assert.equal(result.metadata.provider, 'anthropic', 'Should use default provider')
    })

    test('should fail without required parameters', async () => {
      const paramsNoRole = { task: 'Test task' }
      const resultNoRole = await taskTool.spawnAgent(paramsNoRole)
      assert.equal(resultNoRole.success, false, 'Should fail without role')

      const paramsNoTask = { role: 'execution' }
      const resultNoTask = await taskTool.spawnAgent(paramsNoTask)
      assert.equal(resultNoTask.success, false, 'Should fail without task')
    })

    test('should fail without agent context', async () => {
      taskTool.setAgent(null)
      const params = {
        role: 'execution',
        task: 'Write code'
      }

      const result = await taskTool.spawnAgent(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('agent context'), 'Error should mention missing agent context')
    })

    test('should truncate long task descriptions in result', async () => {
      const longTask = 'a'.repeat(200)
      const params = {
        role: 'execution',
        task: longTask
      }

      const result = await taskTool.spawnAgent(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.ok(result.metadata.task.length <= 103, 'Task should be truncated in metadata')
      assert.ok(result.metadata.task.endsWith('...'), 'Should end with ellipsis')
    })
  })

  describe('reportProgress', () => {
    beforeEach(() => {
      taskTool.setAgent(mockAgent)
      taskTool.setProgressTracker(mockProgressTracker)
    })

    test('should report progress successfully', async () => {
      const params = {
        status: 'in_progress',
        progressPercent: 50,
        details: 'Halfway complete'
      }

      const result = await taskTool.reportProgress(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.equal(result.agentId, 1.1, 'Should return correct agent ID')
      assert.equal(result.status, 'in_progress', 'Should return status')
      assert.equal(result.progressPercent, 50, 'Should return progress percent')

      // Check progress tracker was called
      assert.ok(mockProgressTracker.lastUpdate, 'Should have updated progress tracker')
      assert.equal(mockProgressTracker.lastUpdate.progressData.status, 'in_progress', 'Should track status')
    })

    test('should work without progress tracker', async () => {
      taskTool.setProgressTracker(null)

      const params = {
        status: 'completed'
      }

      const result = await taskTool.reportProgress(params)

      assert.equal(result.success, true, 'Should succeed even without progress tracker')
    })

    test('should fail without status', async () => {
      const params = {
        progressPercent: 25
      }

      const result = await taskTool.reportProgress(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('Status'), 'Error should mention missing status')
    })

    test('should fail without agent context', async () => {
      taskTool.setAgent(null)
      const params = {
        status: 'testing'
      }

      const result = await taskTool.reportProgress(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('agent context'), 'Error should mention missing agent context')
    })

    test('should truncate long details', async () => {
      const longDetails = 'x'.repeat(300)
      const params = {
        status: 'working',
        details: longDetails
      }

      await taskTool.reportProgress(params)

      assert.ok(mockProgressTracker.lastUpdate.progressData.details.length <= 200, 'Details should be truncated')
    })
  })

  describe('requestHelp', () => {
    beforeEach(() => {
      taskTool.setAgent(mockAgent)
      taskTool.setProgressTracker(mockProgressTracker)
    })

    test('should request help successfully', async () => {
      const params = {
        errorDescription: 'Unable to connect to database',
        attemptedSolutions: ['Restarted service', 'Checked credentials'],
        helpNeeded: 'Need database connection troubleshooting'
      }

      const result = await taskTool.requestHelp(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.equal(result.agentId, 1.1, 'Should return correct agent ID')
      assert.ok(result.helpRequestId, 'Should generate help request ID')
      assert.equal(result.errorDescription, params.errorDescription, 'Should return error description')

      // Check progress tracker was updated
      assert.ok(mockProgressTracker.lastUpdate, 'Should have updated progress tracker')
      assert.equal(mockProgressTracker.lastUpdate.progressData.status, 'needs_help', 'Should set needs_help status')
      assert.ok(mockProgressTracker.lastUpdate.progressData.helpRequest, 'Should include help request data')
    })

    test('should work without attempted solutions', async () => {
      const params = {
        errorDescription: 'New error occurred',
        helpNeeded: 'Need immediate assistance'
      }

      const result = await taskTool.requestHelp(params)

      assert.equal(result.success, true, 'Should succeed')
      assert.equal(result.attemptedSolutions.length, 0, 'Should have empty attempted solutions')
    })

    test('should fail without required parameters', async () => {
      const paramsNoError = { helpNeeded: 'Help please' }
      const resultNoError = await taskTool.requestHelp(paramsNoError)
      assert.equal(resultNoError.success, false, 'Should fail without error description')

      const paramsNoHelp = { errorDescription: 'Something broke' }
      const resultNoHelp = await taskTool.requestHelp(paramsNoHelp)
      assert.equal(resultNoHelp.success, false, 'Should fail without help needed')
    })

    test('should fail without agent context', async () => {
      taskTool.setAgent(null)
      const params = {
        errorDescription: 'Error occurred',
        helpNeeded: 'Need help'
      }

      const result = await taskTool.requestHelp(params)

      assert.equal(result.success, false, 'Should fail')
      assert.ok(result.error.includes('agent context'), 'Error should mention missing agent context')
    })

    test('should truncate long text fields', async () => {
      const longError = 'e'.repeat(600)
      const longHelp = 'h'.repeat(300)
      const longSolutions = ['s'.repeat(150), 't'.repeat(150)]

      const params = {
        errorDescription: longError,
        helpNeeded: longHelp,
        attemptedSolutions: longSolutions
      }

      await taskTool.requestHelp(params)

      const helpRequest = mockProgressTracker.lastUpdate.progressData.helpRequest
      assert.ok(helpRequest.errorDescription.length <= 500, 'Error description should be truncated')
      assert.ok(helpRequest.helpNeeded.length <= 200, 'Help needed should be truncated')
      assert.ok(helpRequest.attemptedSolutions[0].length <= 100, 'Solutions should be truncated')
    })
  })

  describe('Integration with ToolRegistry', () => {
    test('should be registered in tool registry', async () => {
      const { ToolRegistry } = await import('../../../src/tools/tool-registry.js')
      const registry = new ToolRegistry()
      await registry.initialize()

      const tools = registry.listTools()
      assert.ok(tools.includes('task'), 'TaskTool should be registered')

      const schema = registry.getToolSchema('task')
      assert.ok(schema, 'Should have TaskTool schema')
      assert.equal(schema.name, 'task', 'Schema should have correct name')
    })

    test('should handle agent context injection via registry', async () => {
      const { ToolRegistry } = await import('../../../src/tools/tool-registry.js')
      const registry = new ToolRegistry()
      await registry.initialize()

      // Mock calling through registry like agent would
      await registry.callTool('task', 'reportProgress',
        { status: 'test' },
        'test-session',
        mockAgent
      )

      // The tool should have received the agent context
      const tool = registry.get('task')
      assert.equal(tool.agent, mockAgent, 'Agent context should be set through registry')
      assert.equal(tool.currentSessionId, 'test-session', 'Session ID should be set through registry')
    })
  })

  describe('Error Handling', () => {
    test('should handle progress tracker errors gracefully', async () => {
      // Mock progress tracker that throws errors
      const errorTracker = {
        updateProgress: async () => {
          throw new Error('Progress tracker failed')
        }
      }

      taskTool.setAgent(mockAgent)
      taskTool.setProgressTracker(errorTracker)

      const result = await taskTool.reportProgress({ status: 'test' })

      assert.equal(result.success, false, 'Should fail when progress tracker throws')
      assert.ok(result.error.includes('Progress tracker failed'), 'Should include tracker error')
    })

    test('should handle subagent spawn failures', async () => {
      const errorAgent = {
        ...mockAgent,
        spawnSubagent: async () => {
          throw new Error('Subagent spawn failed')
        }
      }

      taskTool.setAgent(errorAgent)

      const result = await taskTool.spawnAgent({
        role: 'execution',
        task: 'test task'
      })

      assert.equal(result.success, false, 'Should fail when subagent spawn throws')
      assert.ok(result.error.includes('Subagent spawn failed'), 'Should include spawn error')
    })
  })
})
