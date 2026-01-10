// ABOUTME: Formats job notifications for injection into agent conversations

type JobNotificationType = 'completed' | 'failed' | 'cancelled' | 'progress';

export type FormatJobNotificationOptions = {
  jobId: string;
  type: JobNotificationType;
  exitCode?: number;
  durationMs: number;
  outputBytes: number;
  deltaBytes?: number;
  lastLines: string[];
  reason?: string;
};

const MAX_LINE_LENGTH = 200;

/**
 * Format a duration in milliseconds as a human-readable string.
 * < 60 seconds: "12.3s"
 * >= 60 seconds: "2m 5.0s"
 */
function formatDuration(ms: number): string {
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const mins = Math.floor(ms / 60000);
  const secs = (ms % 60000) / 1000;
  return `${mins}m ${secs.toFixed(1)}s`;
}

/**
 * Format a byte count as a comma-separated number.
 * Example: 15234 -> "15,234"
 */
function formatBytes(bytes: number): string {
  return bytes.toLocaleString('en-US');
}

/**
 * Truncate a line to maxLen characters, adding "..." if truncated.
 */
function truncateLine(line: string, maxLen = MAX_LINE_LENGTH): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 3) + '...';
}

/**
 * Get the status text based on notification type.
 */
function getStatusText(type: JobNotificationType): string {
  switch (type) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'progress':
      return 'running';
  }
}

/**
 * Get the verb for the job_output tool hint based on notification type.
 */
function getOutputVerb(type: JobNotificationType): string {
  switch (type) {
    case 'progress':
      return 'check current output';
    default:
      return 'see full output';
  }
}

/**
 * Format a job notification as an XML-like message for injection into the agent conversation.
 */
export function formatJobNotification(options: FormatJobNotificationOptions): string {
  const { jobId, type, exitCode, durationMs, outputBytes, deltaBytes, lastLines, reason } = options;

  const statusText = getStatusText(type);
  const lines: string[] = [];

  // Opening tag
  lines.push(`<background-job-notification job-id="${jobId}" type="${type}">`);

  // Status
  lines.push(`Status: ${statusText}`);

  // Exit code (only for completed/failed)
  if (exitCode !== undefined && (type === 'completed' || type === 'failed')) {
    lines.push(`Exit code: ${exitCode}`);
  }

  // Duration
  lines.push(`Duration: ${formatDuration(durationMs)}`);

  // Output size
  if (deltaBytes !== undefined && type === 'progress') {
    lines.push(
      `Output: ${formatBytes(outputBytes)} bytes (+${formatBytes(deltaBytes)} since last update)`
    );
  } else {
    lines.push(`Output: ${formatBytes(outputBytes)} bytes`);
  }

  // Reason (for cancelled)
  if (reason && type === 'cancelled') {
    lines.push(`Reason: ${reason}`);
  }

  // Last lines
  if (lastLines.length > 0) {
    const truncatedLines = lastLines.map((line) => truncateLine(line));
    if (truncatedLines.length === 1) {
      lines.push(`Last line: "${truncatedLines[0]}"`);
    } else {
      lines.push(`Last ${truncatedLines.length} lines:`);
      for (const line of truncatedLines) {
        lines.push(`  ${line}`);
      }
    }
  }

  // Hint about job_output tool
  lines.push('');
  lines.push(`Use job_output tool with jobId "${jobId}" to ${getOutputVerb(type)}.`);

  // Closing tag
  lines.push('</background-job-notification>');

  return lines.join('\n');
}
