// ABOUTME: Task notes component for displaying and adding notes to tasks
// ABOUTME: Shows note history and provides form for adding new notes

import React, { useState } from 'react';
import type { TaskNote } from '@/types/api';
import { formatAuthorForDisplay } from '@/lib/display-utils';

interface TaskNotesProps {
  notes: TaskNote[];
  onAddNote: (content: string) => Promise<void>;
}

export function TaskNotes({ notes, onAddNote }: TaskNotesProps) {
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setSubmitting(true);
    try {
      await onAddNote(newNote.trim());
      setNewNote('');
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const formatAuthor = (author: string) => {
    return formatAuthorForDisplay(author);
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-gray-900">Notes</h3>

      {/* Notes list */}
      <div className="space-y-3 max-h-60 overflow-y-auto">
        {notes.length === 0 ? (
          <p className="text-gray-500 text-sm">No notes yet</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">
                  {formatAuthor(String(note.author))}
                </span>
                <span className="text-xs text-gray-500">
                  {formatTimestamp(note.timestamp.toString())}
                </span>
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
            </div>
          ))
        )}
      </div>

      {/* Add note form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          disabled={submitting}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !newNote.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {submitting ? 'Adding...' : 'Add Note'}
          </button>
        </div>
      </form>
    </div>
  );
}
