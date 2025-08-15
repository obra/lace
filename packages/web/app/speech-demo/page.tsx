'use client';

import React, { useState } from 'react';
import { NativeSpeechInput, useSpeechRecognition } from '@/components/ui';
import { EnhancedChatInput } from '@/components/chat/EnhancedChatInput';

export default function SpeechDemoPage() {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');

  // Speech recognition hook for demo
  const {
    transcript,
    isListening,
    error,
    status,
    handleTranscript,
    handleError,
    handleStatusChange,
    clearTranscript,
    clearError,
  } = useSpeechRecognition();

  const handleSubmit = () => {
    if (inputValue.trim()) {
      setMessages((prev) => [...prev, inputValue]);
      setInputValue('');
    }
  };

  const addTranscriptToMessages = (text: string) => {
    setMessages((prev) => [...prev, `🎤 "${text}"`]);
  };

  return (
    <div className="min-h-screen bg-base-100 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">Native Speech Input Demo</h1>
          <p className="text-lg text-base-content/70 mb-6">
            Experience ChatGPT-like voice input with native browser speech recognition
          </p>

          <div className="bg-info/10 border border-info/20 rounded-lg p-4 max-w-2xl mx-auto">
            <h3 className="font-semibold text-info mb-2">🔐 Hardware Permissions Required</h3>
            <p className="text-sm text-info/80">
              This demo uses native OS-level speech recognition. Your browser will request
              microphone permissions when you click the voice button. This provides the same
              experience as ChatGPT&apos;s voice input.
            </p>
          </div>
        </div>

        {/* Standalone Speech Input Demo */}
        <div className="card bg-base-100 shadow border">
          <div className="card-body">
            <h2 className="card-title">Standalone Voice Input Component</h2>
            <p className="text-base-content/70 mb-4">
              Click the microphone to start voice recognition. Speech will be transcribed
              automatically.
            </p>

            <div className="flex items-center gap-4 mb-4">
              <NativeSpeechInput
                onTranscript={handleTranscript}
                onError={handleError}
                onStatusChange={handleStatusChange}
                size="lg"
                variant="primary"
                language="en-US"
                continuous={true}
                interimResults={true}
              />

              <div className="flex flex-col gap-2">
                <div className="text-sm">
                  <span className="font-medium">Status:</span>
                  <span
                    className={`ml-2 px-2 py-1 rounded text-xs ${
                      status === 'listening'
                        ? 'bg-green-100 text-green-800'
                        : status === 'processing'
                          ? 'bg-blue-100 text-blue-800'
                          : status === 'error'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {status}
                  </span>
                </div>

                {isListening && (
                  <div className="text-xs text-base-content/60">
                    🎤 Listening... (Press ESC or click stop)
                  </div>
                )}
              </div>
            </div>

            {/* Live Transcript */}
            {transcript && (
              <div className="bg-base-200 border rounded-lg p-4 mb-4">
                <div className="text-sm font-medium mb-2">Live Transcript:</div>
                <div className="text-base-content/80">&quot;{transcript}&quot;</div>
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      addTranscriptToMessages(transcript);
                      clearTranscript();
                    }}
                  >
                    Add to Messages
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={clearTranscript}>
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="text-sm font-medium text-red-800 mb-2">
                  Speech Recognition Error:
                </div>
                <div className="text-red-700">{error}</div>
                <button className="btn btn-sm btn-outline btn-error mt-2" onClick={clearError}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced Chat Input Demo */}
        <div className="card bg-base-100 shadow border">
          <div className="card-body">
            <h2 className="card-title">Production Chat Input with Real-time Audio Visualization</h2>
            <p className="text-base-content/70 mb-4">
              Complete production-ready chat input with native speech recognition, real-time
              microphone level visualization, file attachments, and circular emerald send button.
            </p>

            <EnhancedChatInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Type your message or click the microphone to speak..."
              speechLanguage="en-US"
              autoSubmitOnSpeech={false}
              showVoiceButton={true}
              showFileAttachment={true}
            />

            <div className="mt-4 text-xs text-base-content/60 space-y-2">
              <p>
                💡 <strong>Real-time Audio:</strong> The input background changes color intensity
                based on your microphone levels - speak louder to see more emerald color!
              </p>
              <p>
                🎤 <strong>Features:</strong> Circular emerald send button, live audio
                visualization, seamless speech-to-text, and ChatGPT-like experience.
              </p>
            </div>
          </div>
        </div>

        {/* Messages Display */}
        <div className="card bg-base-100 shadow border">
          <div className="card-body">
            <h2 className="card-title">Message History</h2>
            <p className="text-base-content/70 mb-4">
              Messages sent through the chat input appear here. Voice messages are marked with 🎤.
            </p>

            {messages.length === 0 ? (
              <div className="text-center text-base-content/50 py-8">
                No messages yet. Try typing or using voice input above.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {messages.map((message, index) => (
                  <div key={index} className="bg-base-200 rounded-lg p-3">
                    <div className="text-sm text-base-content/60 mb-1">Message #{index + 1}</div>
                    <div className="text-base-content">{message}</div>
                  </div>
                ))}
              </div>
            )}

            {messages.length > 0 && (
              <button className="btn btn-sm btn-ghost mt-4" onClick={() => setMessages([])}>
                Clear Messages
              </button>
            )}
          </div>
        </div>

        {/* Browser Support Info */}
        <div className="card bg-base-200 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Browser Compatibility</h3>
            <div className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>Chrome/Chromium: Full support</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>Safari: Full support (macOS/iOS)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                <span>Firefox: Limited support</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                <span>Edge: Variable support</span>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Details */}
        <div className="card bg-base-200 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Technical Implementation</h3>
            <div className="text-sm space-y-2">
              <div>
                <strong>API:</strong> Web Speech API (SpeechRecognition)
              </div>
              <div>
                <strong>Permissions:</strong> navigator.mediaDevices.getUserMedia()
              </div>
              <div>
                <strong>Fallbacks:</strong> WebKit prefixed API for Safari
              </div>
              <div>
                <strong>Features:</strong> Continuous recognition, interim results, multiple
                languages
              </div>
              <div>
                <strong>Privacy:</strong> All processing happens locally in browser
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
