// ABOUTME: Sophisticated token estimation utility for different content types
// ABOUTME: Provides content-aware token counting for synthesis decision making

export class TokenEstimator {
  constructor (options = {}) {
    this.baseRatio = options.baseRatio || 4 // Default: 4 chars per token

    // Content-specific ratios based on empirical analysis
    this.contentRatios = {
      json: 3.5, // JSON is denser due to structure
      code: 3.2, // Code is densest
      technical: 3.8, // Dense technical text
      natural: 4.0 // Regular prose
    }
  }

  /**
   * Estimate token count for text with content-aware analysis
   * @param {string} text - Text to analyze
   * @returns {number} Estimated token count
   */
  estimate (text) {
    if (!text || typeof text !== 'string') return 0

    const length = text.length
    const contentType = this.detectContentType(text)
    const ratio = this.contentRatios[contentType] || this.baseRatio

    return Math.ceil(length / ratio)
  }

  /**
   * Detect content type for better estimation accuracy
   * @param {string} text - Text to analyze
   * @returns {string} Content type (json, code, technical, natural)
   */
  detectContentType (text) {
    const jsonMatches = text.match(/[{}[\]",:]/g)
    const codeMatches = text.match(/[(){};=<>]/g)
    const whitespaceMatches = text.match(/\s+/g)

    const jsonDensity = jsonMatches ? jsonMatches.length / text.length : 0
    const codeDensity = codeMatches ? codeMatches.length / text.length : 0
    const whitespaceDensity = whitespaceMatches ? whitespaceMatches.length / text.length : 0

    // JSON structure detection
    if (jsonDensity > 0.1) {
      return 'json'
    }

    // Code detection
    if (codeDensity > 0.1) {
      return 'code'
    }

    // Technical text (low whitespace ratio)
    if (whitespaceDensity < 0.15) {
      return 'technical'
    }

    return 'natural'
  }

  /**
   * Estimate tokens for multiple texts
   * @param {string[]} texts - Array of texts
   * @returns {number[]} Array of token estimates
   */
  estimateBatch (texts) {
    return texts.map(text => this.estimate(text))
  }

  /**
   * Get total tokens for multiple texts
   * @param {string[]} texts - Array of texts
   * @returns {number} Total token count
   */
  estimateTotal (texts) {
    return this.estimateBatch(texts).reduce((sum, count) => sum + count, 0)
  }
}
