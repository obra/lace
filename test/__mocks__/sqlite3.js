// Mock sqlite3 module for Jest tests
import { jest } from '@jest/globals';

export default {
  Database: jest.fn().mockImplementation((path, callback) => {
    // Mock database instance with all required methods
    const db = {
      run: jest.fn((sql, params, callback) => {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }
        if (callback) callback(null);
        return db;
      }),
      get: jest.fn((sql, params, callback) => {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }
        if (callback) callback(null, null);
        return db;
      }),
      all: jest.fn((sql, params, callback) => {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }
        if (callback) callback(null, []);
        return db;
      }),
      close: jest.fn((callback) => {
        if (callback) callback(null);
        return db;
      }),
      prepare: jest.fn((sql) => {
        return {
          run: jest.fn((params, callback) => {
            if (typeof params === 'function') {
              callback = params;
            }
            if (callback) callback(null);
          }),
          get: jest.fn((params, callback) => {
            if (typeof params === 'function') {
              callback = params;
            }
            if (callback) callback(null, null);
          }),
          all: jest.fn((params, callback) => {
            if (typeof params === 'function') {
              callback = params;
            }
            if (callback) callback(null, []);
          }),
          finalize: jest.fn((callback) => {
            if (callback) callback(null);
          })
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
      })
    };
    
    // Call the constructor callback with no error
    if (callback) {
      setTimeout(() => callback(null), 0);
    }
    
    return db;
  })
};