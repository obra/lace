// ABOUTME: Demo component for testing syntax highlighting with various programming languages
// ABOUTME: Used for development and testing purposes

'use client';

import React, { useState } from 'react';
import CodeBlock from '@/components/ui/CodeBlock';
import InlineCode from '@/components/ui/InlineCode';
import { syntaxHighlighting } from '@/lib/syntax-highlighting';
import { syntaxThemeManager } from '@/lib/syntax-themes';
import { performanceMonitor } from '@/lib/performance-utils';

// Type definitions for test results
interface SuccessfulTestResult {
  success: true;
  language: string;
  highlightedLength: number;
  originalLength: number;
  processingTime: number;
  error: null;
}

interface FailedTestResult {
  success: false;
  error: string;
}

type TestResult = SuccessfulTestResult | FailedTestResult;

type TestResults = Record<string, TestResult>;

// Sample code for different languages
const SAMPLE_CODE = {
  javascript: `// JavaScript with async/await
async function fetchUserData(userId) {
  try {
    const response = await fetch(\`/api/users/\${userId}\`);
    const userData = await response.json();
    
    return {
      ...userData,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to fetch user data:', error);
    throw new Error('User not found');
  }
}

// Arrow function with destructuring
const processUsers = (users) => {
  return users
    .filter(({ active }) => active)
    .map(({ id, name, email }) => ({ id, name, email }))
    .sort((a, b) => a.name.localeCompare(b.name));
};`,

  typescript: `// TypeScript with interfaces and generics
interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

interface ApiResponse<T> {
  data: T;
  status: 'success' | 'error';
  message?: string;
}

class UserService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getUser<T extends User>(id: string): Promise<ApiResponse<T>> {
    const response = await fetch(\`\${this.baseUrl}/users/\${id}\`);
    
    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }
    
    return response.json();
  }
}

// Union types and type guards
type Status = 'idle' | 'loading' | 'success' | 'error';

function isError(status: Status): status is 'error' {
  return status === 'error';
}`,

  python: `# Python with classes and decorators
import asyncio
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime

@dataclass
class User:
    id: str
    name: str
    email: str
    is_active: bool = True
    created_at: datetime = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()

class UserRepository:
    def __init__(self, db_connection: Any):
        self.db = db_connection
    
    async def get_user(self, user_id: str) -> Optional[User]:
        """Retrieve a user by ID"""
        query = """
        SELECT id, name, email, is_active, created_at 
        FROM users 
        WHERE id = %s
        """
        
        result = await self.db.fetch_one(query, (user_id,))
        
        if result:
            return User(**result)
        return None
    
    async def get_active_users(self) -> List[User]:
        """Get all active users"""
        query = "SELECT * FROM users WHERE is_active = TRUE"
        results = await self.db.fetch_all(query)
        
        return [User(**row) for row in results]

# List comprehension and lambda
users = [User(f"user_{i}", f"User {i}", f"user{i}@example.com") for i in range(1, 6)]
active_users = list(filter(lambda u: u.is_active, users))`,

  java: `// Java with Spring Boot annotations
package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.*;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}

@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @Autowired
    private UserService userService;
    
    @GetMapping("/{id}")
    public ResponseEntity<User> getUser(@PathVariable String id) {
        Optional<User> user = userService.findById(id);
        return user.map(ResponseEntity::ok)
                  .orElse(ResponseEntity.notFound().build());
    }
    
    @PostMapping
    public ResponseEntity<User> createUser(@RequestBody User user) {
        User savedUser = userService.save(user);
        return ResponseEntity.ok(savedUser);
    }
}

@Service
public class UserService {
    
    private final UserRepository userRepository;
    
    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }
    
    public List<User> getActiveUsers() {
        return userRepository.findAll()
                .stream()
                .filter(User::isActive)
                .collect(Collectors.toList());
    }
}`,

  bash: `#!/bin/bash
# Bash script for deployment automation

set -euo pipefail

# Configuration
APP_NAME="my-app"
DEPLOY_DIR="/opt/\${APP_NAME}"
BACKUP_DIR="/opt/backups"
LOG_FILE="/var/log/\${APP_NAME}-deploy.log"

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m' # No Color

# Logging function
log() {
    echo "\$(date '+%Y-%m-%d %H:%M:%S') - \$1" | tee -a "\${LOG_FILE}"
}

# Error handling
error_exit() {
    echo -e "\${RED}Error: \$1\${NC}" >&2
    exit 1
}

# Check if running as root
if [[ \$EUID -eq 0 ]]; then
   error_exit "This script should not be run as root"
fi

# Function to backup current deployment
backup_current() {
    local backup_name="\${APP_NAME}-\$(date +%Y%m%d-%H%M%S).tar.gz"
    
    if [[ -d "\${DEPLOY_DIR}" ]]; then
        log "Creating backup: \${backup_name}"
        tar -czf "\${BACKUP_DIR}/\${backup_name}" -C "\${DEPLOY_DIR}" .
        
        # Keep only last 5 backups
        ls -t "\${BACKUP_DIR}/\${APP_NAME}"-*.tar.gz | tail -n +6 | xargs -r rm
    fi
}

# Main deployment function
deploy() {
    log "Starting deployment of \${APP_NAME}"
    
    # Run pre-deployment checks
    if ! command -v docker &> /dev/null; then
        error_exit "Docker is not installed"
    fi
    
    # Backup current deployment
    backup_current
    
    # Deploy new version
    log "Deploying new version..."
    docker-compose down
    docker-compose pull
    docker-compose up -d
    
    # Health check
    sleep 10
    if curl -f http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "\${GREEN}Deployment successful!\${NC}"
        log "Deployment completed successfully"
    else
        error_exit "Health check failed"
    fi
}

# Parse command line arguments
while [[ \$# -gt 0 ]]; do
    case \$1 in
        --app-name)
            APP_NAME="\$2"
            shift 2
            ;;
        --deploy-dir)
            DEPLOY_DIR="\$2"
            shift 2
            ;;
        --help)
            echo "Usage: \$0 [--app-name NAME] [--deploy-dir DIR]"
            exit 0
            ;;
        *)
            error_exit "Unknown parameter: \$1"
            ;;
    esac
done

# Run deployment
deploy`,

  css: `/* Modern CSS with Grid and Flexbox */
:root {
  --primary-color: #3b82f6;
  --secondary-color: #6366f1;
  --background-color: #f8fafc;
  --text-color: #1e293b;
  --border-radius: 8px;
  --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* CSS Grid Layout */
.container {
  display: grid;
  grid-template-columns: 250px 1fr;
  grid-template-rows: 60px 1fr;
  grid-template-areas: 
    "sidebar header"
    "sidebar main";
  min-height: 100vh;
  gap: 1rem;
}

.header {
  grid-area: header;
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
  color: white;
  padding: 1rem;
  border-radius: var(--border-radius);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.sidebar {
  grid-area: sidebar;
  background: var(--background-color);
  padding: 1rem;
  border-radius: var(--border-radius);
  border: 1px solid #e2e8f0;
}

.main {
  grid-area: main;
  padding: 1rem;
}

/* Component Styles */
.card {
  background: white;
  border-radius: var(--border-radius);
  padding: 1.5rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  transition: var(--transition);
}

.card:hover {
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: var(--border-radius);
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition);
}

.button:hover {
  background: #2563eb;
  transform: translateY(-1px);
}

.button:active {
  transform: translateY(0);
}

/* Responsive Design */
@media (max-width: 768px) {
  .container {
    grid-template-columns: 1fr;
    grid-template-rows: 60px auto 1fr;
    grid-template-areas: 
      "header"
      "sidebar"
      "main";
  }
  
  .sidebar {
    order: 2;
  }
  
  .main {
    order: 3;
  }
}

/* Animation */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in {
  animation: fadeIn 0.5s ease-out;
}`,

  json: `{
  "name": "syntax-highlighting-demo",
  "version": "1.0.0",
  "description": "A comprehensive syntax highlighting system",
  "main": "index.js",
  "scripts": {
    "start": "next dev",
    "build": "next build",
    "test": "vitest",
    "lint": "eslint src/**/*.{ts,tsx}",
    "format": "prettier --write src/**/*.{ts,tsx}"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "highlight.js": "^11.11.1",
    "tailwindcss": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "keywords": [
    "syntax",
    "highlighting",
    "code",
    "editor",
    "programming"
  ],
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/syntax-highlighting-demo.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/syntax-highlighting-demo/issues"
  },
  "homepage": "https://github.com/yourusername/syntax-highlighting-demo#readme"
}`,

  sql: `-- SQL with complex queries and stored procedures
CREATE DATABASE IF NOT EXISTS user_management;
USE user_management;

-- Create users table
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_created_at (created_at)
);

-- Create user_profiles table
CREATE TABLE user_profiles (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    bio TEXT,
    avatar_url VARCHAR(255),
    website VARCHAR(255),
    location VARCHAR(100),
    birth_date DATE,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id)
);

-- Complex query with CTEs and window functions
WITH user_stats AS (
    SELECT 
        u.id,
        u.username,
        u.email,
        u.created_at,
        CASE 
            WHEN u.last_login IS NULL THEN 'Never logged in'
            WHEN u.last_login > DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'Active'
            WHEN u.last_login > DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 'Inactive'
            ELSE 'Dormant'
        END AS user_status,
        ROW_NUMBER() OVER (ORDER BY u.created_at DESC) as signup_rank,
        COUNT(*) OVER () as total_users
    FROM users u
    WHERE u.is_active = TRUE
),
profile_stats AS (
    SELECT 
        user_id,
        CASE 
            WHEN bio IS NOT NULL THEN 1 
            ELSE 0 
        END as has_bio,
        CASE 
            WHEN avatar_url IS NOT NULL THEN 1 
            ELSE 0 
        END as has_avatar
    FROM user_profiles
)
SELECT 
    us.username,
    us.email,
    us.user_status,
    us.signup_rank,
    us.total_users,
    COALESCE(ps.has_bio, 0) as has_bio,
    COALESCE(ps.has_avatar, 0) as has_avatar,
    CASE 
        WHEN ps.has_bio = 1 AND ps.has_avatar = 1 THEN 'Complete'
        WHEN ps.has_bio = 1 OR ps.has_avatar = 1 THEN 'Partial'
        ELSE 'Empty'
    END as profile_completeness
FROM user_stats us
LEFT JOIN profile_stats ps ON us.id = ps.user_id
ORDER BY us.created_at DESC
LIMIT 50;

-- Stored procedure for user management
DELIMITER $$

CREATE PROCEDURE GetUserAnalytics(
    IN start_date DATE,
    IN end_date DATE,
    OUT total_users INT,
    OUT active_users INT,
    OUT new_users INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    -- Total users
    SELECT COUNT(*) INTO total_users
    FROM users
    WHERE is_active = TRUE;
    
    -- Active users (logged in within date range)
    SELECT COUNT(*) INTO active_users
    FROM users
    WHERE is_active = TRUE
      AND last_login BETWEEN start_date AND end_date;
    
    -- New users (created within date range)
    SELECT COUNT(*) INTO new_users
    FROM users
    WHERE created_at BETWEEN start_date AND end_date;
    
    COMMIT;
END$$

DELIMITER ;`
};

export default function SyntaxHighlightingDemo() {
  const [selectedLanguage, setSelectedLanguage] = useState<string>('javascript');
  const [testResults, setTestResults] = useState<TestResults>({});
  const [isRunningTests, setIsRunningTests] = useState(false);

  const runTests = async () => {
    setIsRunningTests(true);
    setTestResults({});
    
    const results: TestResults = {};
    
    for (const [lang, code] of Object.entries(SAMPLE_CODE)) {
      try {
        const startTime = performance.now();
        const result = await syntaxHighlighting.highlightCode(code, lang);
        const endTime = performance.now();
        
        results[lang] = {
          success: result.success,
          language: result.language,
          highlightedLength: result.highlighted.length,
          originalLength: code.length,
          processingTime: endTime - startTime,
          error: null
        };
      } catch (error) {
        results[lang] = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
    
    setTestResults(results);
    setIsRunningTests(false);
  };

  const getPerformanceMetrics = () => {
    return performanceMonitor.getAllMetrics();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">Syntax Highlighting Demo</h1>
        <p className="text-base-content/70 mb-4">
          Test the syntax highlighting system with various programming languages.
        </p>
        
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={runTests}
            disabled={isRunningTests}
            className="btn btn-primary"
          >
            {isRunningTests ? 'Running Tests...' : 'Run All Tests'}
          </button>
          
          <button
            onClick={() => setTestResults({})}
            className="btn btn-secondary"
          >
            Clear Results
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Language Selector */}
        <div className="lg:col-span-1">
          <h3 className="text-lg font-semibold mb-3">Select Language</h3>
          <div className="space-y-2">
            {Object.keys(SAMPLE_CODE).map((lang) => (
              <button
                key={lang}
                onClick={() => setSelectedLanguage(lang)}
                className={`w-full text-left p-3 rounded border transition-colors \${
                  selectedLanguage === lang
                    ? 'bg-primary text-primary-content'
                    : 'bg-base-100 hover:bg-base-200'
                }`}
              >
                <div className="font-medium">{lang.toUpperCase()}</div>
                <div className="text-sm opacity-70">
                  {SAMPLE_CODE[lang as keyof typeof SAMPLE_CODE].split('\\n').length} lines
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Code Display */}
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold mb-3">
            Code Preview - {selectedLanguage.toUpperCase()}
          </h3>
          <CodeBlock
            code={SAMPLE_CODE[selectedLanguage as keyof typeof SAMPLE_CODE]}
            language={selectedLanguage}
            showLineNumbers={true}
            showCopyButton={true}
            showLanguageLabel={true}
            maxHeight="600px"
          />
        </div>
      </div>

      {/* Test Results */}
      {Object.keys(testResults).length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Test Results</h3>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Success</th>
                  <th>Detected Language</th>
                  <th>Original Size</th>
                  <th>Highlighted Size</th>
                  <th>Processing Time</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(testResults).map(([lang, result]) => (
                  <tr key={lang}>
                    <td className="font-mono">{lang}</td>
                    <td>
                      <div className={`badge \${result.success ? 'badge-success' : 'badge-error'}`}>
                        {result.success ? 'Success' : 'Failed'}
                      </div>
                    </td>
                    <td className="font-mono">{result.success ? result.language : 'N/A'}</td>
                    <td>{result.success ? result.originalLength.toLocaleString() : 'N/A'}</td>
                    <td>{result.success ? result.highlightedLength.toLocaleString() : 'N/A'}</td>
                    <td>{result.success ? `\${result.processingTime.toFixed(2)}ms` : 'N/A'}</td>
                    <td>
                      {!result.success && (
                        <div className="text-error text-sm" title={result.error}>
                          {result.error.length > 50 ? `\${result.error.substring(0, 50)}...` : result.error}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inline Code Demo */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Inline Code Demo</h3>
        <div className="prose max-w-none">
          <p>
            Here&apos;s some inline code examples: <InlineCode code="const x = 42;" />,{' '}
            <InlineCode code="import React from 'react'" />, and{' '}
            <InlineCode code="SELECT * FROM users WHERE active = true" />.
          </p>
          <p>
            You can also use inline code with language hints:{' '}
            <InlineCode code="console.log('Hello, world!');" language="javascript" enableHighlighting={true} />.
          </p>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Performance Metrics</h3>
        <div className="bg-base-200 p-4 rounded">
          <pre className="text-sm overflow-auto">
            {JSON.stringify(getPerformanceMetrics(), null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}