// ABOUTME: Integration tests for Step 14 diff highlighting functionality
// ABOUTME: Tests unified diff display with color highlighting for file changes

import React from "react";
import Message from "@/ui/components/Message";

describe("Step 14: Diff Highlighting", () => {
  test("detects and highlights simple diff content", () => {
    const messageWithDiff = {
      type: "assistant" as const,
      content: `I'll modify the file for you:

\`\`\`diff
--- a/src/utils.js
+++ b/src/utils.js
@@ -1,5 +1,6 @@
 function calculate(a, b) {
-  return a + b;
+  return a + b + 1;
+  // Added one to the calculation
 }
 
 module.exports = calculate;
\`\`\``,
    };

    const element = Message({
      type: messageWithDiff.type,
      content: messageWithDiff.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    expect(element.type).toBeTruthy();

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    expect(textContent).toContain("--- a/src/utils.js");
    expect(textContent).toContain("+++ b/src/utils.js");

    // Should contain colored diff lines with ANSI codes
    expect(textContent).toContain("\x1b[31m-  return a + b;\x1b[0m"); // Red deletion line
    expect(textContent).toContain("\x1b[32m+  return a + b + 1;\x1b[0m"); // Green addition line
    expect(textContent).toContain(
      "\x1b[32m+  // Added one to the calculation\x1b[0m",
    ); // Green addition line
  });

  test("highlights diff additions with green color", () => {
    const messageWithAdditions = {
      type: "assistant" as const,
      content: `\`\`\`diff
+++ b/new-file.js
@@ -0,0 +1,3 @@
+function newFunction() {
+  return 'hello';
+}
\`\`\``,
    };

    const element = Message({
      type: messageWithAdditions.type,
      content: messageWithAdditions.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Should contain green ANSI color codes for additions
    expect(textContent).toContain("\x1b[32m"); // Green color code
    expect(textContent).toContain("\x1b[32m+function newFunction() {\x1b[0m");
    expect(textContent).toContain("\x1b[32m+  return 'hello';\x1b[0m");
    expect(textContent).toContain("\x1b[32m+}\x1b[0m");
  });

  test("highlights diff deletions with red color", () => {
    const messageWithDeletions = {
      type: "assistant" as const,
      content: `\`\`\`diff
--- a/old-file.js
+++ /dev/null
@@ -1,3 +0,0 @@
-function oldFunction() {
-  return 'goodbye';
-}
\`\`\``,
    };

    const element = Message({
      type: messageWithDeletions.type,
      content: messageWithDeletions.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Should contain red ANSI color codes for deletions
    expect(textContent).toContain("\x1b[31m"); // Red color code
    expect(textContent).toContain("\x1b[31m-function oldFunction() {\x1b[0m");
    expect(textContent).toContain("\x1b[31m-  return 'goodbye';\x1b[0m");
    expect(textContent).toContain("\x1b[31m-}\x1b[0m");
  });

  test("handles mixed diff with additions and deletions", () => {
    const mixedDiff = {
      type: "assistant" as const,
      content: `\`\`\`diff
--- a/function.js
+++ b/function.js
@@ -1,5 +1,5 @@
 function process(data) {
-  console.log('Processing...');
+  console.log('Processing data...');
   return data.toUpperCase();
 }
\`\`\``,
    };

    const element = Message({
      type: mixedDiff.type,
      content: mixedDiff.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Should contain both red and green color codes
    expect(textContent).toContain("\x1b[31m"); // Red for deletion
    expect(textContent).toContain("\x1b[32m"); // Green for addition
    expect(textContent).toContain(
      "\x1b[31m-  console.log('Processing...');\x1b[0m",
    );
    expect(textContent).toContain(
      "\x1b[32m+  console.log('Processing data...');\x1b[0m",
    );
  });

  test("handles diff context lines without color", () => {
    const diffWithContext = {
      type: "assistant" as const,
      content: `\`\`\`diff
--- a/config.js
+++ b/config.js
@@ -2,7 +2,7 @@
 const config = {
   port: 3000,
-  debug: false,
+  debug: true,
   timeout: 5000
 };
\`\`\``,
    };

    const element = Message({
      type: diffWithContext.type,
      content: diffWithContext.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Context lines should not have color codes before them
    expect(textContent).toContain(" const config = {");
    expect(textContent).toContain(" };");
    expect(textContent).toContain("   timeout: 5000");

    // But diff lines should have colors
    expect(textContent).toContain("\x1b[31m-  debug: false,\x1b[0m");
    expect(textContent).toContain("\x1b[32m+  debug: true,\x1b[0m");
  });

  test.skip("ignores non-diff code blocks", () => {
    const regularCode = {
      type: "assistant" as const,
      content: `Here's some JavaScript:

\`\`\`javascript
function hello() {
  console.log('Hello world');
}
\`\`\``,
    };

    const element = Message({
      type: regularCode.type,
      content: regularCode.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Should not contain diff-style color codes (colors with +/- prefixes)
    expect(textContent).not.toContain("\x1b[31m-"); // No red deletion lines
    expect(textContent).not.toContain("\x1b[32m+"); // No green addition lines

    // Should still contain the code content (may be within code block markers with syntax highlighting)
    expect(textContent).toContain("function");
    expect(textContent).toContain("hello()");
    expect(textContent).toContain("console.log(");
    expect(textContent).toContain("```javascript");
  });

  test("handles multiple diff blocks in one message", () => {
    const multipleDiffs = {
      type: "assistant" as const,
      content: `I'll update two files:

First file:
\`\`\`diff
--- a/file1.js
+++ b/file1.js
@@ -1,1 +1,1 @@
-const old = 'value';
+const new = 'value';
\`\`\`

Second file:
\`\`\`diff
--- a/file2.js
+++ b/file2.js
@@ -1,1 +1,1 @@
-let x = 1;
+let x = 2;
\`\`\``,
    };

    const element = Message({
      type: multipleDiffs.type,
      content: multipleDiffs.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Should handle both diff blocks
    expect(textContent).toContain("--- a/file1.js");
    expect(textContent).toContain("--- a/file2.js");
    expect(textContent).toContain("\x1b[31m-const old = 'value';\x1b[0m");
    expect(textContent).toContain("\x1b[32m+const new = 'value';\x1b[0m");
    expect(textContent).toContain("\x1b[31m-let x = 1;\x1b[0m");
    expect(textContent).toContain("\x1b[32m+let x = 2;\x1b[0m");
  });

  test("handles diff headers and hunk headers correctly", () => {
    const diffWithHeaders = {
      type: "assistant" as const,
      content: `\`\`\`diff
--- a/src/app.js
+++ b/src/app.js
@@ -10,6 +10,7 @@ class App {
   constructor() {
     this.name = 'app';
+    this.version = '1.0.0';
   }
 
   start() {
\`\`\``,
    };

    const element = Message({
      type: diffWithHeaders.type,
      content: diffWithHeaders.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Diff headers should be visible but not colored as additions/deletions
    expect(textContent).toContain("--- a/src/app.js");
    expect(textContent).toContain("+++ b/src/app.js");
    expect(textContent).toContain("@@ -10,6 +10,7 @@ class App {");

    // Addition should be colored
    expect(textContent).toContain(
      "\x1b[32m+    this.version = '1.0.0';\x1b[0m",
    );
  });

  test("preserves diff formatting with proper indentation", () => {
    const indentedDiff = {
      type: "assistant" as const,
      content: `\`\`\`diff
--- a/nested.js
+++ b/nested.js
@@ -1,8 +1,8 @@
 if (condition) {
   if (nested) {
-    doOldThing();
+    doNewThing();
   }
 }
\`\`\``,
    };

    const element = Message({
      type: indentedDiff.type,
      content: indentedDiff.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    // Should preserve indentation in diff lines
    expect(textContent).toContain("\x1b[31m-    doOldThing();\x1b[0m");
    expect(textContent).toContain("\x1b[32m+    doNewThing();\x1b[0m");
    expect(textContent).toContain("   if (nested) {");
  });

  test("falls back gracefully if diff processing fails", () => {
    const malformedDiff = {
      type: "assistant" as const,
      content: `\`\`\`diff
This is not a valid diff format
But should still display
\`\`\``,
    };

    const element = Message({
      type: malformedDiff.type,
      content: malformedDiff.content,
      isHighlighted: false,
      searchTerm: "",
    }) as any;

    // Should not crash and should display the content
    expect(element.type).toBeTruthy();

    // Extract the content string from the React element structure
    const textContent =
      element.props.children[0].props.children[1].props.children;

    expect(textContent).toContain("This is not a valid diff format");
    expect(textContent).toContain("But should still display");
  });
});
