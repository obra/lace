// Mock ModelProvider for Jest tests
import { jest } from '@jest/globals'

export class ModelProvider {
  constructor (config) {
    this.config = config
  }

  initialize = jest.fn().mockResolvedValue(undefined)
}
