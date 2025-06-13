// Mock sqlite3 module for Jest tests
import { jest } from "@jest/globals";

function Database(path, callback) {
  // In-memory storage for mock database
  const tables = {};
  let idCounter = 1;

  // Mock database instance with all required methods
  const db = {
    run: jest.fn((sql, params, callback) => {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }
      
      try {
        // Simulate CREATE TABLE
        if (sql.includes('CREATE TABLE')) {
          const match = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
          if (match) {
            const tableName = match[1];
            if (!tables[tableName]) {
              tables[tableName] = [];
            }
          }
        }
        
        // Simulate INSERT
        else if (sql.includes('INSERT INTO')) {
          const match = sql.match(/INSERT INTO (\w+)/i);
          if (match) {
            const tableName = match[1];
            if (!tables[tableName]) {
              tables[tableName] = [];
            }
            
            // Create a row object from the parameters
            const row = { id: idCounter++ };
            
            // For conversations table, map parameters to expected columns
            if (tableName === 'conversations' && params) {
              row.session_id = params[0];
              row.generation = params[1];
              row.role = params[2];
              row.content = params[3];
              row.tool_calls = params[4];
              row.context_size = params[5];
              row.timestamp = new Date().toISOString();
            }
            
            tables[tableName].push(row);
          }
        }
        
        if (callback) {
          const context = { lastID: idCounter - 1 };
          callback.call(context, null);
        }
      } catch (error) {
        if (callback) callback(error);
      }
      return db;
    }),
    get: jest.fn((sql, params, callback) => {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }
      
      try {
        // Simulate SELECT with LIMIT 1
        const rows = simulateSelect(sql, params);
        if (callback) callback(null, rows[0] || null);
      } catch (error) {
        if (callback) callback(error);
      }
      return db;
    }),
    all: jest.fn((sql, params, callback) => {
      if (typeof params === "function") {
        callback = params;
        params = [];
      }
      
      try {
        const rows = simulateSelect(sql, params);
        if (callback) callback(null, rows);
      } catch (error) {
        if (callback) callback(error);
      }
      return db;
    }),
    close: jest.fn((callback) => {
      if (callback) {
        process.nextTick(() => callback(null));
      }
      return db;
    }),
    prepare: jest.fn((sql) => {
      return {
        run: jest.fn((params, callback) => {
          if (typeof params === "function") {
            callback = params;
          }
          if (callback) callback(null);
        }),
        get: jest.fn((params, callback) => {
          if (typeof params === "function") {
            callback = params;
          }
          if (callback) callback(null, null);
        }),
        all: jest.fn((params, callback) => {
          if (typeof params === "function") {
            callback = params;
          }
          if (callback) callback(null, []);
        }),
        finalize: jest.fn((callback) => {
          if (callback) callback(null);
        }),
      };
    }),
    exec: jest.fn((sql, callback) => {
      if (callback) callback(null);
      return db;
    }),
    serialize: jest.fn((callback) => {
      if (callback) callback();
      return db;
    }),
    parallelize: jest.fn((callback) => {
      if (callback) callback();
      return db;
    }),
  };

  // Helper function to simulate SELECT queries
  function simulateSelect(sql, params) {
    // Handle basic SELECT queries
    const selectMatch = sql.match(/SELECT \* FROM (\w+)/i);
    if (!selectMatch) return [];
    
    const tableName = selectMatch[1];
    if (!tables[tableName]) return [];
    
    let rows = [...tables[tableName]];
    
    // Handle WHERE clauses
    if (sql.includes('WHERE')) {
      if (sql.includes('session_id = ?') && params && params[0]) {
        rows = rows.filter(row => row.session_id === params[0]);
      }
      if (sql.includes('content LIKE ?') && params && params[1]) {
        const searchTerm = params[1].replace(/%/g, '');
        rows = rows.filter(row => row.content && row.content.includes(searchTerm));
      }
      if (sql.includes('generation = ?') && params && params[1] !== undefined) {
        rows = rows.filter(row => row.generation === params[1]);
      }
    }
    
    // Handle ORDER BY
    if (sql.includes('ORDER BY id DESC')) {
      rows.sort((a, b) => b.id - a.id);
    } else if (sql.includes('ORDER BY timestamp ASC')) {
      rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else if (sql.includes('ORDER BY timestamp DESC')) {
      rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    
    // Handle LIMIT
    const limitMatch = sql.match(/LIMIT (\d+)/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      rows = rows.slice(0, limit);
    } else if (sql.includes('LIMIT ?') && params) {
      // Handle parameterized LIMIT - find the last parameter which should be the limit
      const limitParamIndex = params.length - 1;
      if (params[limitParamIndex] !== undefined) {
        const limit = parseInt(params[limitParamIndex]);
        rows = rows.slice(0, limit);
      }
    }
    
    return rows;
  }

  // Call the constructor callback with no error
  if (callback) {
    process.nextTick(() => callback(null));
  }

  return db;
}

export default { Database };
