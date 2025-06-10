// ABOUTME: Utility for extracting and normalizing text content from tool results
// ABOUTME: Handles different tool result formats and structures consistently

export class ToolResultExtractor {
  constructor () {
    // Define extraction strategies for different result types
    this.extractors = {
      string: (result) => result,
      object: (result) => this.extractFromObject(result),
      array: (result) => this.extractFromArray(result),
      error: (result) => this.extractFromError(result)
    }
  }

  /**
   * Extract text content from any tool result format
   * @param {*} toolResult - Tool result in any format
   * @returns {string} Extracted text content
   */
  extract (toolResult) {
    if (!toolResult) return ''

    const resultType = this.getResultType(toolResult)
    const extractor = this.extractors[resultType]

    return extractor ? extractor(toolResult) : String(toolResult)
  }

  /**
   * Determine the type of tool result for appropriate extraction
   * @param {*} result - Tool result
   * @returns {string} Result type
   */
  getResultType (result) {
    if (typeof result === 'string') return 'string'
    if (Array.isArray(result)) return 'array'
    if (result && typeof result === 'object') {
      if (result.error || result.denied) return 'error'
      return 'object'
    }
    return 'string' // Fallback
  }

  /**
   * Extract text from object-type results
   * @param {Object} result - Object result
   * @returns {string} Extracted text
   */
  extractFromObject (result) {
    // Priority order for extracting meaningful content
    const contentFields = [
      'content', 'result', 'output', 'data',
      'response', 'value', 'text', 'message'
    ]

    // Try primary content fields first
    for (const field of contentFields) {
      if (result[field] !== undefined) {
        return this.stringify(result[field])
      }
    }

    // If no primary field, check for success/failure patterns
    if (result.success !== undefined) {
      let text = `Success: ${result.success}`
      if (result.result) text += `\nResult: ${this.stringify(result.result)}`
      if (result.error) text += `\nError: ${result.error}`
      return text
    }

    // Fallback: stringify the entire object, but filter out metadata
    const filtered = this.filterMetadata(result)
    return JSON.stringify(filtered, null, 2)
  }

  /**
   * Extract text from array-type results
   * @param {Array} result - Array result
   * @returns {string} Extracted text
   */
  extractFromArray (result) {
    if (result.length === 0) return 'Empty array result'

    // If array contains simple values, join them
    if (result.every(item => typeof item !== 'object')) {
      return result.join('\n')
    }

    // If array contains objects, extract from each
    return result.map((item, index) => {
      const extracted = this.extract(item)
      return `[${index}] ${extracted}`
    }).join('\n\n')
  }

  /**
   * Extract text from error-type results
   * @param {Object} result - Error result
   * @returns {string} Extracted error text
   */
  extractFromError (result) {
    let text = ''

    if (result.error) {
      text += `Error: ${result.error}`
    }

    if (result.denied) {
      text += text ? '\n' : ''
      text += `Access denied: ${result.reason || 'No reason provided'}`
    }

    // Include any additional context
    if (result.toolCall) {
      text += `\nTool: ${result.toolCall.name}`
    }

    return text || 'Unknown error result'
  }

  /**
   * Convert any value to string representation
   * @param {*} value - Value to stringify
   * @returns {string} String representation
   */
  stringify (value) {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value === null || value === undefined) return String(value)

    try {
      return JSON.stringify(value, null, 2)
    } catch (error) {
      return String(value)
    }
  }

  /**
   * Filter out metadata fields that don't contain meaningful content
   * @param {Object} obj - Object to filter
   * @returns {Object} Filtered object
   */
  filterMetadata (obj) {
    const metadataFields = [
      'timestamp', 'id', 'userId', 'sessionId', 'requestId',
      'metadata', 'headers', 'status', 'statusCode',
      'duration', 'executionTime', 'version'
    ]

    const filtered = {}
    for (const [key, value] of Object.entries(obj)) {
      if (!metadataFields.includes(key)) {
        filtered[key] = value
      }
    }

    return filtered
  }

  /**
   * Extract content from multiple tool results
   * @param {Array} toolResults - Array of tool results
   * @returns {string[]} Array of extracted content
   */
  extractBatch (toolResults) {
    return toolResults.map(result => this.extract(result))
  }

  /**
   * Get summary statistics about tool results
   * @param {Array} toolResults - Array of tool results
   * @returns {Object} Summary statistics
   */
  analyzeResults (toolResults) {
    const extracted = this.extractBatch(toolResults)
    const lengths = extracted.map(text => text.length)

    return {
      count: toolResults.length,
      totalLength: lengths.reduce((sum, len) => sum + len, 0),
      averageLength: lengths.length > 0 ? lengths.reduce((sum, len) => sum + len, 0) / lengths.length : 0,
      maxLength: Math.max(...lengths, 0),
      minLength: Math.min(...lengths, 0),
      types: toolResults.map(result => this.getResultType(result))
    }
  }
}
