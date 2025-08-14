# Authentication Implementation Plan for Lace Web Interface

## Overview
We're adding password-based authentication to the Lace web interface. This is a single-user application that needs to be secure when exposed over network (e.g., via Tailscale) but convenient for local development.

## Key Design Decisions
1. **Password Storage**: Store hashed password in `~/.lace/auth.json` (using Node's built-in `crypto.scrypt`)
2. **Authentication**: JWT tokens with configurable expiry
3. **JWT Secret**: Persisted in `~/.lace/auth.json` to survive server restarts
4. **Auto-login**: When starting from console, generate one-time token for automatic browser login
5. **Password Management**: CLI command `--reset-password` to generate new password
6. **No Custom Crypto**: Use only battle-tested libraries (crypto.scrypt for hashing, jose for JWT in Edge Runtime)

## Technology Stack
- **Password Hashing**: Node.js built-in `crypto.scrypt` (NO custom crypto)
- **JWT Library (Node.js)**: `jsonwebtoken` package for API routes
- **JWT Library (Edge)**: `jose` package for Next.js middleware (Edge Runtime compatible)
- **Cookie Management**: Next.js built-in cookie handling
- **Middleware**: Next.js middleware for route protection (runs on Edge Runtime)

## Implementation Tasks

### Task 1: Add JWT dependencies
**Files to modify:**
- `packages/web/package.json`

**What to do:**
1. Add `jsonwebtoken` and `@types/jsonwebtoken` for Node.js API routes
2. Add `jose` for Edge Runtime middleware (Next.js middleware compatible)
3. Run `npm install` in packages/web directory

**Test:**
```bash
cd packages/web
npm install
npm run test:run  # Verify nothing broke
```

**Commit message:** "Add jsonwebtoken dependency for authentication"

---

### Task 2: Create auth configuration module with tests
**Files to create:**
- `packages/web/lib/server/auth-config.test.ts` (CREATE FIRST - TDD!)
- `packages/web/lib/server/auth-config.ts`

**Note:** Using `lib/server/` directory to match existing project structure for server-side utilities.

**Test file (`packages/web/lib/server/auth-config.test.ts`) - Write this FIRST:**
```typescript
// ABOUTME: Tests for authentication configuration and password management
// ABOUTME: Verifies secure password generation, hashing, and verification

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import {
  generatePassword,
  hashPassword,
  verifyPassword,
  loadAuthConfig,
  saveAuthConfig,
  initializeAuth,
  resetPassword,
  getOrInitializeAuth,
  getOrGenerateJWTSecret,
  type AuthConfig
} from '@/lib/server/auth-config';

describe('Auth Configuration', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'lace-auth-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    // Clean up
    if (originalLaceDir) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generatePassword', () => {
    it('should generate a password of reasonable length', () => {
      const password = generatePassword();
      expect(password).toBeTruthy();
      expect(password.length).toBeGreaterThanOrEqual(20);
      expect(password.length).toBeLessThanOrEqual(30);
    });

    it('should generate unique passwords', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 10; i++) {
        passwords.add(generatePassword());
      }
      expect(passwords.size).toBe(10);
    });
  });

  describe('hashPassword and verifyPassword', () => {
    it('should hash and verify a password correctly', async () => {
      const password = 'test-password-123';
      const { hash, salt } = await hashPassword(password);
      
      expect(hash).toBeTruthy();
      expect(salt).toBeTruthy();
      expect(hash).not.toBe(password);
      
      const isValid = await verifyPassword(password, hash, salt);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'correct-password';
      const { hash, salt } = await hashPassword(password);
      
      const isValid = await verifyPassword('wrong-password', hash, salt);
      expect(isValid).toBe(false);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'same-password';
      const result1 = await hashPassword(password);
      const result2 = await hashPassword(password);
      
      expect(result1.hash).not.toBe(result2.hash);
      expect(result1.salt).not.toBe(result2.salt);
    });
  });

  describe('loadAuthConfig and saveAuthConfig', () => {
    it('should return null when no config exists', () => {
      const config = loadAuthConfig();
      expect(config).toBeNull();
    });

    it('should save and load auth config', async () => {
      const config: AuthConfig = {
        passwordHash: 'test-hash',
        salt: 'test-salt',
        iterations: 32768,
        createdAt: new Date().toISOString(),
        algorithm: 'scrypt',
        jwtSecret: 'test-jwt-secret'
      };
      
      saveAuthConfig(config);
      
      const loaded = loadAuthConfig();
      expect(loaded).toEqual(config);
    });

    it('should create auth.json with restrictive permissions', () => {
      const config: AuthConfig = {
        passwordHash: 'test-hash',
        salt: 'test-salt',
        iterations: 32768,
        createdAt: new Date().toISOString(),
        algorithm: 'scrypt',
        jwtSecret: 'test-jwt-secret'
      };
      
      saveAuthConfig(config);
      
      const authPath = path.join(tempDir, 'auth.json');
      const stats = fs.statSync(authPath);
      // Check that only owner can read/write (0600)
      const mode = stats.mode & parseInt('777', 8);
      expect(mode).toBe(parseInt('600', 8));
    });
  });

  describe('initializeAuth', () => {
    it('should generate password and save config', async () => {
      const password = await initializeAuth();
      
      expect(password).toBeTruthy();
      expect(password.length).toBeGreaterThanOrEqual(20);
      
      const config = loadAuthConfig();
      expect(config).not.toBeNull();
      expect(config?.algorithm).toBe('scrypt');
      expect(config?.passwordHash).toBeTruthy();
      expect(config?.salt).toBeTruthy();
      expect(config?.jwtSecret).toBeTruthy();
      
      // Verify the generated password works
      const isValid = await verifyPassword(
        password,
        config!.passwordHash,
        config!.salt
      );
      expect(isValid).toBe(true);
    });
  });

  describe('resetPassword', () => {
    it('should generate new password and update config', async () => {
      // Initialize first
      const oldPassword = await initializeAuth();
      const oldConfig = loadAuthConfig();
      
      // Reset
      const newPassword = await resetPassword();
      const newConfig = loadAuthConfig();
      
      expect(newPassword).not.toBe(oldPassword);
      expect(newConfig?.passwordHash).not.toBe(oldConfig?.passwordHash);
      expect(newConfig?.salt).not.toBe(oldConfig?.salt);
      
      // Old password should not work
      const oldValid = await verifyPassword(
        oldPassword,
        newConfig!.passwordHash,
        newConfig!.salt
      );
      expect(oldValid).toBe(false);
      
      // New password should work
      const newValid = await verifyPassword(
        newPassword,
        newConfig!.passwordHash,
        newConfig!.salt
      );
      expect(newValid).toBe(true);
    });
  });

  describe('getOrInitializeAuth', () => {
    it('should return existing config without password', async () => {
      // Create existing config
      await initializeAuth();
      
      const { config, password } = await getOrInitializeAuth();
      
      expect(config).not.toBeNull();
      expect(password).toBeUndefined();
    });

    it('should initialize and return password on first run', async () => {
      const { config, password } = await getOrInitializeAuth();
      
      expect(config).not.toBeNull();
      expect(password).toBeTruthy();
      expect(password!.length).toBeGreaterThanOrEqual(20);
      
      // Verify password works
      const isValid = await verifyPassword(
        password!,
        config.passwordHash,
        config.salt
      );
      expect(isValid).toBe(true);
    });
  });

  describe('getOrGenerateJWTSecret', () => {
    it('should generate JWT secret on first call', () => {
      const secret = getOrGenerateJWTSecret();
      expect(secret).toBeTruthy();
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });

    it('should return same secret on subsequent calls', () => {
      const secret1 = getOrGenerateJWTSecret();
      const secret2 = getOrGenerateJWTSecret();
      expect(secret1).toBe(secret2);
    });

    it('should persist JWT secret in config', async () => {
      await initializeAuth();
      const secret = getOrGenerateJWTSecret();
      
      const config = loadAuthConfig();
      expect(config?.jwtSecret).toBe(secret);
    });
  });
});
```

**Implementation file (`packages/web/lib/server/auth-config.ts`):**
Write this AFTER all tests pass. Use the test as your specification.

**AuthConfig interface:**
```typescript
export interface AuthConfig {
  passwordHash: string;
  salt: string;
  iterations: number;
  createdAt: string;
  algorithm: 'scrypt';
  jwtSecret: string;  // Persisted to survive server restarts
}
```

Key points:
- Use `crypto.randomBytes` for password and JWT secret generation
- Use `crypto.scrypt` for hashing (NOT bcrypt, NOT custom)
- Store in `getLaceFilePath('auth.json')` - import from core Lace: `import { getLaceFilePath } from '~/config/lace-dir';`
- Set file permissions to 0600 (owner read/write only)
- JWT secret is generated once and persisted
- NEVER use `any` type - use proper TypeScript types

**How to test:**
```bash
cd packages/web
npm run test:run lib/server/auth-config.test.ts
```

**Commit message:** "Add auth configuration module with secure password management"

---

### Task 3: Create JWT token service with tests
**Files to create:**
- `packages/web/lib/server/auth-tokens.test.ts` (CREATE FIRST)
- `packages/web/lib/server/auth-tokens.ts`

**Test file (`packages/web/lib/server/auth-tokens.test.ts`) - Write FIRST:**
```typescript
// ABOUTME: Tests for JWT token generation and validation
// ABOUTME: Verifies token creation, validation, and expiry handling

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateJWT,
  verifyJWT,
  generateOneTimeToken,
  consumeOneTimeToken,
  type TokenPayload
} from '@/lib/server/auth-tokens';

// Mock jsonwebtoken to control time
vi.mock('jsonwebtoken', async () => {
  const actual = await vi.importActual<typeof import('jsonwebtoken')>('jsonwebtoken');
  return {
    ...actual,
    sign: vi.fn(actual.sign),
    verify: vi.fn(actual.verify),
  };
});

describe('Auth Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset one-time tokens
    vi.resetModules();
  });

  describe('generateJWT', () => {
    it('should generate a valid JWT token', () => {
      const token = generateJWT({ userId: 'test-user' });
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format
    });

    it('should include custom expiry', () => {
      const token = generateJWT({ userId: 'test-user' }, '7d');
      const payload = verifyJWT(token);
      expect(payload).not.toBeNull();
      // Token should be valid
    });

    it('should use default expiry when not specified', () => {
      const token = generateJWT({ userId: 'test-user' });
      const payload = verifyJWT(token);
      expect(payload).not.toBeNull();
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid token', () => {
      const token = generateJWT({ userId: 'test-user' });
      const payload = verifyJWT(token);
      
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe('test-user');
    });

    it('should reject invalid token', () => {
      const payload = verifyJWT('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject tampered token', () => {
      const token = generateJWT({ userId: 'test-user' });
      const tampered = token.slice(0, -5) + 'xxxxx';
      
      const payload = verifyJWT(tampered);
      expect(payload).toBeNull();
    });
  });

  describe('One-time tokens', () => {
    it('should generate unique one-time token', () => {
      const token1 = generateOneTimeToken();
      const token2 = generateOneTimeToken();
      
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);
    });

    it('should consume token only once', () => {
      const token = generateOneTimeToken();
      
      const jwt1 = consumeOneTimeToken(token);
      expect(jwt1).toBeTruthy();
      
      const jwt2 = consumeOneTimeToken(token);
      expect(jwt2).toBeNull();
    });

    it('should expire token after timeout', () => {
      vi.useFakeTimers();
      
      const token = generateOneTimeToken();
      
      // Advance time past expiry (31 seconds)
      vi.advanceTimersByTime(31000);
      
      const jwt = consumeOneTimeToken(token);
      expect(jwt).toBeNull();
      
      vi.useRealTimers();
    });

    it('should not expire token before timeout', () => {
      vi.useFakeTimers();
      
      const token = generateOneTimeToken();
      
      // Advance time but not past expiry (29 seconds)
      vi.advanceTimersByTime(29000);
      
      const jwt = consumeOneTimeToken(token);
      expect(jwt).toBeTruthy();
      
      vi.useRealTimers();
    });
  });
});
```

**Implementation (`packages/web/lib/server/auth-tokens.ts`):**
Key requirements:
- Use `jsonwebtoken` library for Node.js API routes
- Get JWT secret from `getOrGenerateJWTSecret()` in auth-config module
- One-time tokens stored in Map with expiry timestamps
- Default JWT expiry: 24 hours
- One-time token expiry: 30 seconds
- Import auth config: `import { getOrGenerateJWTSecret } from '@/lib/server/auth-config';`
- NEVER use `any` type

**Commit message:** "Add JWT token service for authentication"

---

### Task 4: Create auth service combining password and token management
**Files to create:**
- `packages/web/lib/server/auth-service.test.ts` (CREATE FIRST)
- `packages/web/lib/server/auth-service.ts`

**Test file - Write FIRST:**
Test should cover:
- Login with correct/incorrect password
- Getting auth status from JWT
- Generating one-time login URLs
- Integration between password verification and JWT generation

**Commit message:** "Add authentication service integrating passwords and JWT"

---

### Task 5: Create Next.js middleware for authentication
**Files to create:**
- `packages/web/middleware.test.ts` (CREATE FIRST) 
- `packages/web/middleware.ts`

**What it does:**
- Intercepts all API routes except `/api/auth/*`
- Checks for JWT in cookie or Authorization header
- Redirects to `/login` if not authenticated
- Allows localhost bypass if configured

**Test scenarios:**
- Request with valid JWT cookie → allowed
- Request with valid JWT in Authorization header → allowed
- Request without JWT → redirect to /login
- Request to /api/auth/* → always allowed
- Request to /login → always allowed
- Localhost with bypass enabled → allowed

**Important Next.js middleware notes:**
- Runs on Edge Runtime (limited Node.js APIs)
- Must use `jose` library for JWT verification (NOT jsonwebtoken)
- Must export `config` with matcher patterns
- Use `NextResponse.redirect()` for redirects
- Use `NextResponse.next()` to allow request

**Example JWT verification with jose:**
```typescript
import { jwtVerify } from 'jose';

// IMPORTANT: Edge Runtime cannot access file system!
// JWT secret must be provided via environment variable for middleware
// Set LACE_JWT_SECRET env var from the auth.json jwtSecret value
const secret = new TextEncoder().encode(
  process.env.LACE_JWT_SECRET || 'fallback-dev-secret'
);

try {
  const { payload } = await jwtVerify(token, secret);
  // Token is valid
} catch {
  // Token is invalid
}
```

**Critical Edge Runtime Note:**
The Next.js middleware runs in Edge Runtime which CANNOT access the file system. This means:
1. Cannot read auth.json directly
2. Must pass JWT secret via environment variable
3. Server.ts should read auth.json and set process.env.LACE_JWT_SECRET before starting Next.js

**Commit message:** "Add authentication middleware for route protection"

---

### Task 6: Create login page component
**Files to create:**
- `packages/web/app/login/page.test.tsx` (CREATE FIRST)
- `packages/web/app/login/page.tsx`
- `packages/web/app/login/layout.tsx`

**Login page requirements:**
- Simple password input field
- Submit button
- Error message display
- Redirect to `/` on success
- Remember me checkbox (30-day token)
- Clean, minimal design

**Test scenarios:**
- Renders password field and submit button
- Shows error on wrong password
- Redirects on successful login
- Sets appropriate cookie expiry with "Remember me"

**Commit message:** "Add login page for authentication"

---

### Task 7: Create auth API routes
**Files to create:**
- `packages/web/app/api/auth/login/route.test.ts` (CREATE FIRST)
- `packages/web/app/api/auth/login/route.ts`
- `packages/web/app/api/auth/logout/route.test.ts`
- `packages/web/app/api/auth/logout/route.ts`
- `packages/web/app/api/auth/status/route.test.ts`
- `packages/web/app/api/auth/status/route.ts`
- `packages/web/app/api/auth/exchange/route.test.ts` (CREATE FIRST)
- `packages/web/app/api/auth/exchange/route.ts`

**Login route:**
- POST `/api/auth/login`
- Body: `{ password: string, rememberMe?: boolean }`
- Returns JWT and sets httpOnly cookie
- 401 on wrong password

**Logout route:**
- POST `/api/auth/logout`
- Clears auth cookie
- Always returns 200

**Status route:**
- GET `/api/auth/status`
- Returns `{ authenticated: boolean }`
- No auth required (used by login page)

**Exchange route (for one-time tokens):**
- POST `/api/auth/exchange`
- Body: `{ token: string }`
- Exchanges one-time token for JWT
- Returns JWT and sets httpOnly cookie
- 401 on invalid/expired token

**Commit message:** "Add authentication API endpoints"

---

### Task 8: Modify server.ts for auto-login
**Files to modify:**
- `packages/web/server.test.ts` (MODIFY FIRST - add tests)
- `packages/web/server.ts`

**Changes needed:**
1. Import auth service functions
2. Load auth config and set `process.env.LACE_JWT_SECRET` for Edge Runtime middleware
3. On server start, generate one-time token
4. Open browser to `http://localhost:port/?token=xxx`
5. Client uses `/api/auth/exchange` route (created in Task 7) to exchange token for JWT

**Test scenarios:**
- Server generates one-time token on start
- Browser opens with token in URL
- Token can be exchanged for JWT
- Token expires after 30 seconds
- Token can only be used once

**Commit message:** "Add auto-login support for console users"

---

### Task 9: Update all API routes to check authentication
**Files to modify:**
All files in `packages/web/app/api/**/*.ts` except auth routes

**Pattern to add at start of each handler:**
```typescript
import { isAuthenticated } from '@/lib/server/auth-service';

export async function GET(request: NextRequest) {
  // Check authentication
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  // ... rest of handler
}
```

**Important:**
- Update tests first to expect 401 when not authenticated
- Add auth token to test requests
- Do NOT modify routes under `/api/auth/`

**Commit message:** "Secure all API endpoints with authentication checks"

---

### Task 10: Add --reset-password CLI option
**Files to modify:**
- `packages/web/server.test.ts` (ADD TESTS FIRST)
- `packages/web/server.ts`

**Implementation:**
1. Check for `--reset-password` in command args
2. If present, call `resetPassword()` from auth module
3. Display new password to console
4. Exit (don't start server)

**Test scenarios:**
- Running with --reset-password generates new password
- New password is displayed
- Server doesn't start
- Old password no longer works

**Commit message:** "Add --reset-password CLI option"

---

### Task 11: Add Security settings panel
**Files to create:**
- `packages/web/components/settings/panels/SecuritySettingsPanel.test.tsx` (FIRST)
- `packages/web/components/settings/panels/SecuritySettingsPanel.tsx`

**UI Requirements:**
- Display when password was last changed
- Show auth config file location
- Instruct user to use `--reset-password` CLI command
- No in-browser password change (security decision)

**Commit message:** "Add Security settings panel"

---

### Task 12: Integration tests
**Files to create:**
- `packages/web/e2e/authentication.e2e.ts`

**Test full flow:**
1. Start server
2. Auto-login works
3. Logout works
4. Login page works
5. Protected routes require auth
6. Token expiry works
7. Reset password works

**Use Playwright for browser testing**

**Commit message:** "Add end-to-end authentication tests"

---

## Testing Guidelines

### Test-Driven Development (TDD)
1. **ALWAYS** write tests FIRST
2. Run test, verify it FAILS
3. Write minimal code to make test PASS
4. Refactor if needed
5. Run test again to verify it still passes

### Testing Best Practices
- **NEVER** mock the functionality you're testing
- **NEVER** use `any` type in tests
- Use real file system with temp directories (not mocks)
- Use real crypto functions (not mocks)
- Only mock external services when absolutely necessary
- Test actual behavior, not implementation details

### Running Tests
```bash
# Run all tests
cd packages/web
npm run test:run

# Run specific test file
npm run test:run path/to/test.ts

# Run tests in watch mode (during development)
npm run test:watch

# Run with coverage
npm run test:coverage
```

## TypeScript Requirements

### NEVER use `any` type
```typescript
// BAD
const data: any = loadConfig();

// GOOD
const data: AuthConfig | null = loadConfig();
```

### Use proper types for everything
```typescript
// BAD
function verify(token) { ... }

// GOOD
function verify(token: string): TokenPayload | null { ... }
```

### Use type guards when needed
```typescript
// When dealing with unknown data
function isAuthConfig(data: unknown): data is AuthConfig {
  return (
    typeof data === 'object' &&
    data !== null &&
    'passwordHash' in data &&
    'salt' in data
  );
}
```

## Security Requirements

### NEVER roll custom crypto
- Use `crypto.scrypt` for password hashing
- Use `crypto.randomBytes` for random generation
- Use `jsonwebtoken` for JWT handling
- NO custom encryption algorithms
- NO custom hashing algorithms
- NO custom random generators

### Password Storage
- ALWAYS hash passwords before storage
- NEVER store plaintext passwords
- Use salt for each password
- Use sufficient iterations (32768+)

### File Permissions
- Auth config file should be 0600 (owner read/write only)
- Use `fs.writeFileSync` with `mode` option

## Git Workflow

### Commit frequently
After each task completion:
```bash
git add -A
git commit -m "Clear, descriptive message"
```

### Commit message format
- Present tense
- Clear and specific
- Under 72 characters
- Examples:
  - "Add JWT token service for authentication"
  - "Secure API endpoints with auth checks"
  - "Fix token expiry validation in auth service"

## Common Pitfalls to Avoid

1. **Don't skip tests** - Write them first, always
2. **Don't use any type** - TypeScript is there for a reason
3. **Don't mock what you're testing** - Test real behavior
4. **Don't roll custom crypto** - Use established libraries
5. **Don't store secrets in code** - Generate at runtime
6. **Don't forget error handling** - Every async operation can fail
7. **Don't skip permissions** - Auth files need proper permissions
8. **Don't trust user input** - Validate everything

## Resources

### Documentation to reference
- [Node.js Crypto](https://nodejs.org/api/crypto.html) - for scrypt usage
- [jsonwebtoken npm](https://www.npmjs.com/package/jsonwebtoken) - for JWT API
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware) - for route protection
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers) - for auth endpoints
- [Vitest](https://vitest.dev/) - for testing syntax

### Files to study as examples
- `packages/web/lib/middleware/rate-limiter.ts` - middleware pattern
- `packages/web/app/api/threads/[threadId]/message/route.ts` - API route pattern
- `packages/web/app/api/threads/[threadId]/message/route.test.ts` - API testing pattern
- `src/config/lace-dir.ts` - config file management pattern

## Questions to Ask Before Starting

1. Do I have all dependencies installed?
2. Do I understand the test-first approach?
3. Do I know which crypto functions to use?
4. Do I understand Next.js middleware?
5. Do I know how to avoid using `any` type?

## Final Checklist

Before considering the implementation complete:

- [ ] All tests written FIRST and passing
- [ ] No `any` types anywhere
- [ ] No custom crypto implementation
- [ ] All API routes protected
- [ ] Login page works
- [ ] Auto-login from console works
- [ ] Password reset CLI works
- [ ] Security settings panel shows info
- [ ] File permissions set correctly
- [ ] Integration tests pass
- [ ] Code follows existing patterns
- [ ] All commits made with clear messages