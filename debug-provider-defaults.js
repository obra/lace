// Quick debug script to see if provider defaults are working
const { setupTestProviderDefaults } = require('./dist/test-utils/provider-defaults.js');
const { ProviderInstanceManager } = require('./dist/providers/instance/manager.js');

console.log('Before setupTestProviderDefaults:');
console.log('ANTHROPIC_KEY:', process.env.ANTHROPIC_KEY);
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY);

setupTestProviderDefaults();

console.log('\nAfter setupTestProviderDefaults:');
console.log('ANTHROPIC_KEY:', process.env.ANTHROPIC_KEY);
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY);

const manager = new ProviderInstanceManager();
const config = manager.getDefaultConfig();

console.log('\nDefault config:');
console.log(JSON.stringify(config, null, 2));