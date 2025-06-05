// ABOUTME: Babel configuration for Jest testing with ES modules support
// ABOUTME: Configures transpilation for ES modules to work with Jest

export default {
  presets: [
    ['@babel/preset-env', {
      targets: {
        node: 'current'
      }
    }]
  ]
};