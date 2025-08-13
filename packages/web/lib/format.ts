// ABOUTME: Time formatting utilities for displaying timestamps in the UI
// ABOUTME: Provides consistent time formatting across the application

export function formatTime(timestamp: Date): string {
  return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getCurrentTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
