#!/bin/bash
# ABOUTME: Script to find which test creates .git in packages/core
# ABOUTME: Runs tests one at a time and checks for .git pollution

set -e

CORE_DIR="/Users/jesse/Documents/GitHub/lace/.worktrees/post-compaction-ui/packages/core"
GIT_DIR="$CORE_DIR/.git"

echo "Finding which test creates .git in $CORE_DIR"
echo "================================================"

# Clean up any existing .git
if [ -d "$GIT_DIR" ]; then
    echo "Removing existing .git..."
    rm -rf "$GIT_DIR"
fi

# Find all test files
TEST_FILES=$(find src -name "*.test.ts" -type f | sort)

# Track results
POLLUTERS=()
CLEAN_TESTS=()

for test_file in $TEST_FILES; do
    # Check if .git exists before test
    if [ -d "$GIT_DIR" ]; then
        echo "⚠️  .git already exists before $test_file - skipping"
        POLLUTERS+=("$test_file (pre-existing)")
        continue
    fi

    echo -n "Testing: $test_file ... "

    # Run the test
    if npx vitest run "$test_file" > /tmp/test-output-$$.log 2>&1; then
        TEST_STATUS="✓"
    else
        TEST_STATUS="✗"
    fi

    # Check if .git was created
    if [ -d "$GIT_DIR" ]; then
        echo "$TEST_STATUS POLLUTER FOUND! ❌"
        POLLUTERS+=("$test_file")

        # Show timestamp
        ls -ld "$GIT_DIR" | awk '{print "  Created:", $6, $7, $8}'

        # Don't remove it yet - let user inspect
        echo "  Stopping here. .git directory left for inspection."
        echo "  Run: ls -la $GIT_DIR"
        echo "  Run: git -C $CORE_DIR status"
        exit 1
    else
        echo "$TEST_STATUS clean"
        CLEAN_TESTS+=("$test_file")
    fi
done

echo ""
echo "================================================"
echo "Summary:"
echo "  Clean tests: ${#CLEAN_TESTS[@]}"
echo "  Polluters: ${#POLLUTERS[@]}"

if [ ${#POLLUTERS[@]} -gt 0 ]; then
    echo ""
    echo "Tests that created .git:"
    for polluter in "${POLLUTERS[@]}"; do
        echo "  - $polluter"
    done
    exit 1
else
    echo ""
    echo "✅ No tests created .git in source directory!"
    exit 0
fi
