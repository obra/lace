// ABOUTME: Voice recognition UI component for desktop interfaces
// ABOUTME: Provides visual feedback for voice input with waveform animation

'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faTimes } from '~/interfaces/web/lib/fontawesome';
import { modalOverlay, modalContent, loadingDot } from '~/interfaces/web/lib/animations';

interface VoiceRecognitionUIProps {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  confidence: number;
  error: string;
  onStop: () => void;
  onCancel: () => void;
}

export function VoiceRecognitionUI({
  isListening,
  transcript,
  interimTranscript,
  confidence,
  error,
  onStop,
  onCancel,
}: VoiceRecognitionUIProps) {
  if (!isListening) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        variants={modalOverlay}
        initial="initial"
        animate="animate"
        exit="exit"
        onClick={onCancel}
      >
        <motion.div
          className="bg-base-100 rounded-2xl p-6 max-w-md w-full shadow-2xl"
          variants={modalContent}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <motion.div
                className="w-12 h-12 bg-teal-600 rounded-full flex items-center justify-center text-white"
                animate={{
                  scale: [1, 1.1, 1],
                  boxShadow: [
                    '0 0 0 0 rgba(20, 184, 166, 0.7)',
                    '0 0 0 10px rgba(20, 184, 166, 0)',
                    '0 0 0 0 rgba(20, 184, 166, 0.7)',
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                <FontAwesomeIcon icon={faMicrophone} className="w-6 h-6" />
              </motion.div>
              <div>
                <h3 className="text-lg font-semibold text-base-content">Voice Input</h3>
                <p className="text-sm text-base-content/60">
                  {error ? 'Error occurred' : 'Listening for your message...'}
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-2 hover:bg-base-200 rounded-lg transition-colors"
            >
              <FontAwesomeIcon icon={faTimes} className="w-5 h-5 text-base-content/60" />
            </button>
          </div>

          {/* Voice Waveform Visualization */}
          <div className="flex items-center justify-center gap-1 mb-6 h-12">
            {Array.from({ length: 5 }, (_, i) => (
              <motion.div
                key={i}
                className="w-2 bg-teal-600 rounded-full"
                variants={loadingDot}
                animate="animate"
                style={{
                  height: '12px',
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  delay: i * 0.1,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Transcript Display */}
          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-error/10 border border-error/30 rounded-lg">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            {(transcript || interimTranscript) && (
              <div className="p-3 bg-base-200 rounded-lg min-h-[80px]">
                <div className="text-sm text-base-content/70 mb-2">Transcript:</div>
                <div className="text-base text-base-content">
                  {transcript && <span className="font-medium">{transcript}</span>}
                  {interimTranscript && (
                    <span className="text-base-content/60 italic">{interimTranscript}</span>
                  )}
                  {!transcript && !interimTranscript && (
                    <span className="text-base-content/40">Speak now...</span>
                  )}
                </div>
                {confidence > 0 && (
                  <div className="text-xs text-base-content/50 mt-2">
                    Confidence: {Math.round(confidence * 100)}%
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={onCancel}
              className="flex-1 btn btn-outline"
            >
              Cancel
            </button>
            <button
              onClick={onStop}
              className="flex-1 btn btn-primary"
              disabled={!transcript && !interimTranscript}
            >
              {transcript ? 'Use Text' : 'Stop Listening'}
            </button>
          </div>

          {/* Instructions */}
          <div className="text-xs text-base-content/50 text-center mt-4">
            Speak clearly into your microphone. Click "Stop Listening" when finished.
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}