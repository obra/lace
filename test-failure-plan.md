# Test Failure Analysis and Fix Plan

## ✅ COMPLETED - Summary of Fixes

Originally had **87 failed tests** across 12 test suites. Now down to **23 failed tests** across 4 test suites.

### ✅ **Major Issues Fixed:**

1. **SQLite database mocking** - ✅ SOLVED: Removed unnecessary SQLite mocks, use real in-memory SQLite
2. **ActivityLogger tests** - ✅ SOLVED: All 14 ActivityLogger unit tests now pass
3. **UI component test setup** - ✅ SOLVED: All 34 UI ActivityLogger tests pass
4. **TypeScript compilation** - ✅ SOLVED: Fixed debugLogger → debugLogging interface issue

## 🔧 Remaining Issues (23 tests)

Much smaller scope, different root causes:

## Root Cause Analysis

### 1. SQLite Mock Mismatch (Primary Issue)

**Files affected:** `test/unit/activity-logger.test.js`, all ActivityLogger tests

**Root cause:** The sqlite3 mock in `test/__mocks__/sqlite3.js` doesn't properly simulate the real Database constructor behavior:

- Real code: `this.db = new Database.Database(path, callback)`
- Mock returns a db object, but `this.db.close()` expects the callback pattern
- The mock's close method exists but async callback behavior is broken

**Evidence:**

```
TypeError: this.db.close is not a function
at src/logging/activity-logger.js:148:17
```

### 2. Jest Module Resolution (Secondary Issue)

**Files affected:** `test/ui/integration/activity-logging.test.tsx`, `test/ui/unit/lace-ui-activity.test.ts`

**Root cause:** Relative path imports like `../../../src/logging/activity-logger.js` fail in Jest with current resolver configuration:

- The commented out `moduleNameMapper` regex was handling `.js` extension stripping
- Current resolver can't locate modules with relative paths from test files

**Evidence:**

```
Could not locate module ../../../src/logging/activity-logger.js mapped as: $1
```

### 3. Test Timeout Issues (Symptom)

**Files affected:** Multiple agent and integration tests

**Root cause:** Tests hanging due to broken mock behaviors, not actual timeout issues

- ActivityLogger.close() never resolves due to mock issue
- Agent tests likely depend on ActivityLogger initialization

## Fix Plan (Priority Order)

### Phase 1: Fix SQLite Mock (High Priority)

1. **Update sqlite3 mock** to properly simulate Database constructor:

   ```js
   export default {
     Database: jest.fn().mockImplementation((path, callback) => {
       const db = {
         close: jest.fn((callback) => {
           process.nextTick(() => callback && callback(null));
         }),
         // ... other methods
       };
       process.nextTick(() => callback && callback(null));
       return db;
     }),
   };
   ```

2. **Create activity-logger mock** at `test/__mocks__/activity-logger.js` to avoid sqlite3 entirely for UI tests

### Phase 2: Fix Module Resolution (Medium Priority)

1. **Add activity-logger to moduleNameMapper** in jest.config.js:

   ```js
   '^.*src/logging/activity-logger.js$': '<rootDir>/test/__mocks__/activity-logger.js'
   ```

2. **Use absolute path imports** in test files instead of relative paths

### Phase 3: Verify Test Infrastructure (Low Priority)

1. **Run tests incrementally** to verify each fix
2. **Check for remaining timeout issues** after mock fixes
3. **Validate UI component tests** work with proper mocks

## Expected Outcomes

- **Phase 1**: ActivityLogger tests pass, timeout issues resolved
- **Phase 2**: UI integration tests can import and mock ActivityLogger
- **Phase 3**: Full test suite passes with clean output

## Risk Assessment

- **Low risk**: Mock changes are isolated to test files
- **Medium risk**: Module resolution changes might affect other imports
- **Mitigation**: Test incrementally, revert moduleNameMapper if issues arise

## Test Strategy

1. Fix sqlite3 mock first - this should resolve ~50+ failed tests immediately
2. Test with: `npm run test:jest -- --testNamePattern="ActivityLogger"`
3. Add activity-logger mock and test UI components
4. Run full suite to verify no regressions
