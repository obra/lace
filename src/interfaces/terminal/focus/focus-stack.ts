// ABOUTME: Focus stack implementation for hierarchical navigation in terminal UI
// ABOUTME: Manages focus context hierarchy with push/pop operations and state tracking

/**
 * A stack-based focus management system that maintains hierarchical navigation state.
 *
 * The focus stack tracks the user's navigation context, allowing them to "push" into
 * deeper contexts (shell → timeline → delegation) and "pop" back out using Escape.
 *
 * Example flow:
 * 1. Start: ['shell-input']
 * 2. Navigate to timeline: ['shell-input', 'timeline']
 * 3. Enter delegation: ['shell-input', 'timeline', 'delegate-abc123']
 * 4. Escape: ['shell-input', 'timeline']
 * 5. Escape: ['shell-input']
 */
export class FocusStack {
  private stack: string[] = ['shell-input'];

  /**
   * Push a new focus context onto the stack.
   * Prevents duplicate consecutive pushes of the same focus ID.
   * @param focusId - The focus ID to push
   * @returns The pushed focus ID
   */
  push(focusId: string): string {
    // Prevent pushing the same focus ID consecutively
    if (this.current() === focusId) {
      return focusId; // Already on top, don't push again
    }
    this.stack.push(focusId);
    return focusId;
  }

  /**
   * Pop the current focus context, returning to the previous one.
   * Will not pop the last item (always keeps at least one item).
   * @returns The new current focus ID, or undefined if stack would be empty
   */
  pop(): string | undefined {
    if (this.stack.length > 1) {
      this.stack.pop();
      return this.current();
    }
    return undefined;
  }

  /**
   * Get the current (top) focus ID without modifying the stack.
   * @returns The current focus ID
   */
  current(): string {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Clear the stack and reset to the default state.
   */
  clear(): void {
    this.stack = ['shell-input'];
  }

  /**
   * Check if a focus ID exists anywhere in the stack.
   * @param focusId - The focus ID to search for
   * @returns True if the focus ID is in the stack
   */
  contains(focusId: string): boolean {
    return this.stack.includes(focusId);
  }

  /**
   * Get the current size of the focus stack.
   * @returns The number of items in the stack
   */
  size(): number {
    return this.stack.length;
  }

  /**
   * Get a copy of the entire stack for debugging/testing.
   * @returns A copy of the current stack array
   */
  getStack(): string[] {
    return [...this.stack];
  }
}
