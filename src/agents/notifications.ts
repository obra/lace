// ABOUTME: Notification formatting utilities for system messages to agents
// ABOUTME: Formats task assignments and completions into structured agent messages

export class NotificationFormatter {
  static formatTaskAssignment(task: {
    title: string;
    prompt: string;
    priority: string;
    createdBy: string;
  }): string {
    return `[LACE TASK SYSTEM] You have been assigned a new task:
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---`;
  }

  static formatTaskCompletion(task: {
    title: string;
    assignedTo: string;
    notes: Array<{ content: string; author: string }>;
  }): string {
    const notesSection =
      task.notes.length > 0
        ? `\n--- COMPLETION NOTES ---\n${task.notes
            .filter((note) => note.content.trim()) // Filter out empty notes
            .map((note) => `${note.author}: ${note.content}`)
            .join('\n')}\n--- END NOTES ---`
        : '';

    return `[LACE TASK SYSTEM] Task completed:
Title: "${task.title}"
Completed by: ${task.assignedTo}${notesSection}`;
  }
}
