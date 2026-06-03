// ABOUTME: Example MCP server that validates a JSON value against a JSON Schema.
// ABOUTME: Demonstrates a self-contained, useful MCP tool: agents frequently generate
// ABOUTME: JSON (configs, API payloads, structured output) and need to verify it before
// ABOUTME: handing it off. No external dependencies beyond the MCP SDK.
//
// Usage (stdio, same as all lace MCP servers):
//   node json-schema-validator-server.mjs
//
// Exposes one tool: validate_json
//   - schema: string  (JSON Schema as a JSON string)
//   - value:  string  (JSON value to validate, as a JSON string)
// Returns: { valid: boolean, errors: string[] }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Minimal JSON Schema validator (object / array / primitives, required check)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ type?: string, properties?: Record<string, JsonSchemaNode>, required?: string[], items?: JsonSchemaNode, enum?: unknown[], minimum?: number, maximum?: number, minLength?: number, maxLength?: number }} JsonSchemaNode
 */

/**
 * Validate a value against a JSON Schema node.
 * Returns an array of error strings (empty = valid).
 * @param {unknown} value
 * @param {JsonSchemaNode} schema
 * @param {string} path
 * @returns {string[]}
 */
function validate(value, schema, path = '') {
  const errors = [];
  const loc = path || '(root)';

  // enum check
  if (Array.isArray(schema.enum)) {
    const match = schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
    if (!match) {
      errors.push(`${loc}: must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    }
    return errors;
  }

  // type check
  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value === 'number' && !Number.isInteger(value) ? 'number' : value === null ? 'null' : typeof value;
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    // json-schema "integer" maps to a number with no fractional part
    const typeMatch = expectedTypes.some((t) => {
      if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
      if (t === 'array') return Array.isArray(value);
      if (t === 'null') return value === null;
      return actualType === t;
    });
    if (!typeMatch) {
      errors.push(`${loc}: expected type ${JSON.stringify(schema.type)}, got ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`);
      // Cannot check sub-properties if wrong type
      return errors;
    }
  }

  if (schema.type === 'object' || (typeof value === 'object' && value !== null && !Array.isArray(value))) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    // required
    for (const req of schema.required ?? []) {
      if (!(req in obj)) {
        errors.push(`${loc}: missing required property '${req}'`);
      }
    }
    // properties
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        errors.push(...validate(obj[key], propSchema, `${loc}.${key}`));
      }
    }
  }

  if (schema.type === 'array' || Array.isArray(value)) {
    const arr = /** @type {unknown[]} */ (value);
    if (schema.items) {
      arr.forEach((item, i) => {
        errors.push(...validate(item, schema.items, `${loc}[${i}]`));
      });
    }
    if (schema.minItems !== undefined && arr.length < schema.minItems) {
      errors.push(`${loc}: array length ${arr.length} is less than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && arr.length > schema.maxItems) {
      errors.push(`${loc}: array length ${arr.length} exceeds maxItems ${schema.maxItems}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${loc}: ${value} is less than minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${loc}: ${value} exceeds maximum ${schema.maximum}`);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${loc}: string length ${value.length} is less than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${loc}: string length ${value.length} exceeds maxLength ${schema.maxLength}`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: 'json-schema-validator', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.registerTool(
  'validate_json',
  {
    description:
      'Validate a JSON value against a JSON Schema. ' +
      'Returns { valid: true } on success, or { valid: false, errors: [...] } on failure. ' +
      'Both schema and value must be provided as JSON strings.',
    inputSchema: {
      schema: z.string().describe('The JSON Schema to validate against (as a JSON string)'),
      value: z.string().describe('The JSON value to validate (as a JSON string)'),
    },
  },
  ({ schema: schemaStr, value: valueStr }) => {
    let schema;
    let value;

    try {
      schema = JSON.parse(schemaStr);
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ valid: false, errors: ['schema: not valid JSON'] }) }],
      };
    }

    try {
      value = JSON.parse(valueStr);
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ valid: false, errors: ['value: not valid JSON'] }) }],
      };
    }

    const errors = validate(value, schema);
    const result = errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
