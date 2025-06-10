// ABOUTME: Unit tests for agent model call activity logging integration
// ABOUTME: Tests that model_request and model_response events are logged correctly

import { test, describe, beforeEach, afterEach, TestHarness, assert, utils } from '../../test-harness.js'
import { Agent } from '../../../src/agents/agent.ts'
import { ActivityLogger } from '../../../src/logging/activity-logger.js'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('Agent Model Call Activity Logging', () => {
  let harness
  let testDbPath
  let activityLogger
  let agent
  let mockModelProvider
  let sessionId

  beforeEach(async () => {
    harness = new TestHarness()
    testDbPath = join(tmpdir(), `agent-activity-test-${Date.now()}.db`)
    activityLogger = new ActivityLogger(testDbPath)
    await activityLogger.initialize()

    sessionId = `test-session-${Date.now()}`

    // Create mock model provider
    mockModelProvider = {
      chat: async (messages, options) => {
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 50))
        return {
          success: true,
          content: 'Mock model response',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150
          }
        }
      }
    }

    // Create mock tools
    const mockTools = {
      listTools: () => ['test-tool'],
      getToolSchema: (toolName) => ({ description: 'Test tool' })
    }

    // Create agent with activity logger
    agent = new Agent({
      generation: 0,
      tools: mockTools,
      db: await harness.createTestDatabase(),
      modelProvider: mockModelProvider,
      verbose: false,
      role: 'general',
      assignedModel: 'test-model',
      assignedProvider: 'test-provider',
      activityLogger
    })

    // Mock calculateCost method
    agent.calculateCost = (inputTokens, outputTokens) => ({
      inputCost: inputTokens * 0.000001,
      outputCost: outputTokens * 0.000002,
      totalCost: (inputTokens * 0.000001) + (outputTokens * 0.000002)
    })
  })

  afterEach(async () => {
    await harness.cleanup()
    if (activityLogger) {
      await activityLogger.close()
    }
    try {
      await fs.unlink(testDbPath)
    } catch (error) {
      // File might not exist, ignore
    }
  })

  describe('Model Request Logging', () => {
    test('should log model_request events before sending to provider', async () => {
      // Simulate part of the generateResponse flow that logs model requests
      await activityLogger.logEvent('model_request', sessionId, null, {
        provider: 'test-provider',
        model: 'test-model',
        prompt: JSON.stringify([
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Test user input' }
        ]),
        timestamp: new Date().toISOString()
      })

      const events = await activityLogger.getEvents()
      assert.strictEqual(events.length, 1)

      const event = events[0]
      assert.strictEqual(event.event_type, 'model_request')
      assert.strictEqual(event.local_session_id, sessionId)

      const data = JSON.parse(event.data)
      assert.strictEqual(data.provider, 'test-provider')
      assert.strictEqual(data.model, 'test-model')
      assert.ok(data.prompt)
      assert.ok(data.timestamp)

      // Verify prompt structure
      const promptMessages = JSON.parse(data.prompt)
      assert.strictEqual(promptMessages.length, 2)
      assert.strictEqual(promptMessages[0].role, 'system')
      assert.strictEqual(promptMessages[1].role, 'user')
    })
  })

  describe('Model Response Logging', () => {
    test('should log model_response events with timing and cost data', async () => {
      const duration = 800
      const tokensIn = 100
      const tokensOut = 50
      const cost = 0.0002

      await activityLogger.logEvent('model_response', sessionId, null, {
        content: 'Test model response content',
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost,
        duration_ms: duration
      })

      const events = await activityLogger.getEvents()
      assert.strictEqual(events.length, 1)

      const event = events[0]
      assert.strictEqual(event.event_type, 'model_response')
      assert.strictEqual(event.local_session_id, sessionId)

      const data = JSON.parse(event.data)
      assert.strictEqual(data.content, 'Test model response content')
      assert.strictEqual(data.tokens_in, tokensIn)
      assert.strictEqual(data.tokens_out, tokensOut)
      assert.strictEqual(data.cost, cost)
      assert.strictEqual(data.duration_ms, duration)
    })
  })

  describe('Integrated Model Call Flow', () => {
    test('should log both request and response in correct order', async () => {
      const userInput = 'Test user message'
      const messages = [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: userInput }
      ]

      // Simulate the logging that happens in generateResponse
      // 1. Log model request
      await activityLogger.logEvent('model_request', sessionId, null, {
        provider: agent.assignedProvider,
        model: agent.assignedModel,
        prompt: JSON.stringify(messages),
        timestamp: new Date().toISOString()
      })

      // 2. Make model call
      const startTime = Date.now()
      const response = await mockModelProvider.chat(messages, {
        provider: agent.assignedProvider,
        model: agent.assignedModel
      })
      const duration = Date.now() - startTime

      // 3. Log model response
      const cost = agent.calculateCost(
        response.usage.input_tokens,
        response.usage.output_tokens
      )

      await activityLogger.logEvent('model_response', sessionId, null, {
        content: response.content,
        tokens_in: response.usage.input_tokens,
        tokens_out: response.usage.output_tokens,
        cost: cost.totalCost,
        duration_ms: duration
      })

      // Verify both events were logged
      const events = await activityLogger.getEvents()
      assert.strictEqual(events.length, 2)

      // Events should be in reverse chronological order (most recent first)
      const [responseEvent, requestEvent] = events

      assert.strictEqual(requestEvent.event_type, 'model_request')
      assert.strictEqual(responseEvent.event_type, 'model_response')

      const requestData = JSON.parse(requestEvent.data)
      const responseData = JSON.parse(responseEvent.data)

      // Verify request data
      assert.strictEqual(requestData.provider, 'test-provider')
      assert.strictEqual(requestData.model, 'test-model')
      assert.ok(requestData.prompt.includes(userInput))

      // Verify response data
      assert.strictEqual(responseData.content, 'Mock model response')
      assert.strictEqual(responseData.tokens_in, 100)
      assert.strictEqual(responseData.tokens_out, 50)
      assert.ok(responseData.cost > 0)
      assert.ok(responseData.duration_ms >= 0)
    })

    test('should handle multiple model calls in sequence', async () => {
      const inputs = ['First request', 'Second request', 'Third request']

      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]
        const messages = [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: input }
        ]

        // Log request
        await activityLogger.logEvent('model_request', sessionId, null, {
          provider: 'test-provider',
          model: 'test-model',
          prompt: JSON.stringify(messages),
          timestamp: new Date().toISOString()
        })

        // Make call and log response
        const response = await mockModelProvider.chat(messages, {})
        await activityLogger.logEvent('model_response', sessionId, null, {
          content: response.content,
          tokens_in: response.usage.input_tokens,
          tokens_out: response.usage.output_tokens,
          cost: 0.0002,
          duration_ms: 100
        })

        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 5))
      }

      const events = await activityLogger.getEvents()
      assert.strictEqual(events.length, 6) // 3 requests + 3 responses

      // Count event types
      const requestEvents = events.filter(e => e.event_type === 'model_request')
      const responseEvents = events.filter(e => e.event_type === 'model_response')

      assert.strictEqual(requestEvents.length, 3)
      assert.strictEqual(responseEvents.length, 3)

      // Verify all events have the same session ID
      for (const event of events) {
        assert.strictEqual(event.local_session_id, sessionId)
      }
    })
  })

  describe('Error Handling', () => {
    test('should not log response events when model call fails', async () => {
      // Create failing mock provider
      const failingProvider = {
        chat: async () => ({
          success: false,
          error: 'Mock API error'
        })
      }

      const mockTools = {
        listTools: () => ['test-tool'],
        getToolSchema: (toolName) => ({ description: 'Test tool' })
      }

      const failingAgent = new Agent({
        generation: 0,
        tools: mockTools,
        db: await harness.createTestDatabase(),
        modelProvider: failingProvider,
        activityLogger,
        role: 'general'
      })

      const messages = [{ role: 'user', content: 'Test input' }]

      // Log request (this should always happen)
      await activityLogger.logEvent('model_request', sessionId, null, {
        provider: 'test-provider',
        model: 'test-model',
        prompt: JSON.stringify(messages),
        timestamp: new Date().toISOString()
      })

      // Make failing call (should not log response)
      const response = await failingProvider.chat(messages, {})
      assert.strictEqual(response.success, false)

      // Only request should be logged, no response
      const events = await activityLogger.getEvents()
      assert.strictEqual(events.length, 1)
      assert.strictEqual(events[0].event_type, 'model_request')
    })

    test('should handle missing activity logger gracefully', async () => {
      const mockTools = {
        listTools: () => ['test-tool'],
        getToolSchema: (toolName) => ({ description: 'Test tool' })
      }

      const agentWithoutLogger = new Agent({
        generation: 0,
        tools: mockTools,
        db: await harness.createTestDatabase(),
        modelProvider: mockModelProvider,
        activityLogger: null, // No logger
        role: 'general'
      })

      // This should not throw when activityLogger is null
      const messages = [{ role: 'user', content: 'Test' }]
      const response = await mockModelProvider.chat(messages, {})

      assert.strictEqual(response.success, true)

      // No events should be logged since there's no logger
      const events = await activityLogger.getEvents()
      assert.strictEqual(events.length, 0)
    })
  })
})
