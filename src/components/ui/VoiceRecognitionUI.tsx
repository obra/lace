'use client';

import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faTimes } from '~/lib/fontawesome';

interface VoiceRecognitionUIProps {
  isListening: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  transcript?: string;
  interimTranscript?: string;
  confidence?: number;
  error?: string;
  className?: string;
}

export function VoiceRecognitionUI({
  isListening,
  onStartListening,
  onStopListening,
  transcript = '',
  interimTranscript = '',
  confidence = 0,
  error,
  className = '',
}: VoiceRecognitionUIProps) {
  const [audioLevel, setAudioLevel] = useState(0);
  const [animationBars, setAnimationBars] = useState<number[]>([]);

  // Simulate audio level animation when listening
  useEffect(() => {
    if (!isListening) {
      setAudioLevel(0);
      setAnimationBars([]);
      return;
    }

    const interval = setInterval(() => {
      // Simulate audio levels with some randomness
      const newLevel = Math.random() * 100;
      setAudioLevel(newLevel);

      // Generate random heights for visualization bars
      const bars = Array.from({ length: 20 }, () => Math.random() * 100);
      setAnimationBars(bars);
    }, 100);

    return () => clearInterval(interval);
  }, [isListening]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const handleToggleListening = () => {
    if (isListening) {
      onStopListening();
    } else {
      onStartListening();
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Main microphone button */}
      <div className="flex justify-center">
        <button
          onClick={handleToggleListening}
          className={`
            relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200
            ${
              isListening
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg scale-110'
                : 'bg-primary hover:bg-primary-focus text-primary-content shadow-md hover:scale-105'
            }
          `}
          aria-label={isListening ? 'Stop listening' : 'Start listening'}
        >
          {isListening ? (
            <>
              <FontAwesomeIcon icon={faTimes} className="w-6 h-6" />
              {/* Pulsing ring animation */}
              <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-25"></div>
              <div className="absolute inset-2 rounded-full bg-red-400 animate-pulse opacity-50"></div>
            </>
          ) : (
            <FontAwesomeIcon icon={faMicrophone} className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Audio level visualization */}
      {isListening && (
        <div className="space-y-3">
          {/* Waveform visualization */}
          <div className="flex items-end justify-center gap-1 h-16 px-4">
            {animationBars.map((height, index) => (
              <div
                key={index}
                className="bg-primary rounded-t w-1 transition-all duration-100"
                style={{
                  height: `${Math.max(height, 10)}%`,
                  opacity: 0.7 + (height / 100) * 0.3,
                }}
              />
            ))}
          </div>

          {/* Audio level indicator */}
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm text-base-content/60">Level:</span>
            <div className="w-32 h-2 bg-base-300 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-red-500 transition-all duration-100"
                style={{ width: `${audioLevel}%` }}
              />
            </div>
          </div>

          {/* Status text */}
          <div className="text-center">
            <div className="text-sm font-medium text-base-content animate-pulse">Listening...</div>
            <div className="text-xs text-base-content/60 mt-1">Tap the microphone to stop</div>
          </div>
        </div>
      )}

      {/* Transcript display */}
      {(transcript || interimTranscript) && (
        <div className="bg-base-200 border border-base-300 rounded-lg p-4 space-y-2">
          {/* Final transcript */}
          {transcript && (
            <div>
              <div className="text-xs text-base-content/60 mb-1">Transcribed:</div>
              <div className="text-sm text-base-content font-medium">{transcript}</div>
            </div>
          )}

          {/* Interim transcript */}
          {interimTranscript && (
            <div>
              <div className="text-xs text-base-content/60 mb-1">Current:</div>
              <div className="text-sm text-base-content/70 italic">{interimTranscript}</div>
            </div>
          )}

          {/* Confidence indicator */}
          {confidence > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-base-content/60">Confidence:</span>
              <span className={`font-medium ${getConfidenceColor(confidence)}`}>
                {Math.round(confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="text-sm text-red-800">
            <strong>Voice Recognition Error:</strong> {error}
          </div>
        </div>
      )}

      {/* Instructions when not listening */}
      {!isListening && !transcript && !error && (
        <div className="text-center text-sm text-base-content/60 space-y-1">
          <div>Click the microphone to start voice input</div>
          <div className="text-xs">Supports natural language commands</div>
        </div>
      )}
    </div>
  );
}

// Compact version for mobile/inline use
interface CompactVoiceButtonProps {
  isListening: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'ghost' | 'outline';
}

export function CompactVoiceButton({
  isListening,
  onToggle,
  size = 'md',
  variant = 'primary',
}: CompactVoiceButtonProps) {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'w-8 h-8';
      case 'md':
        return 'w-10 h-10';
      case 'lg':
        return 'w-12 h-12';
      default:
        return 'w-10 h-10';
    }
  };

  const getVariantClasses = () => {
    if (isListening) {
      return 'bg-red-500 hover:bg-red-600 text-white';
    }

    switch (variant) {
      case 'primary':
        return 'bg-primary hover:bg-primary-focus text-primary-content';
      case 'ghost':
        return 'bg-transparent hover:bg-base-200 text-base-content';
      case 'outline':
        return 'border border-base-300 hover:bg-base-200 text-base-content';
      default:
        return 'bg-primary hover:bg-primary-focus text-primary-content';
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'sm':
        return 'w-3 h-3';
      case 'md':
        return 'w-4 h-4';
      case 'lg':
        return 'w-5 h-5';
      default:
        return 'w-4 h-4';
    }
  };

  return (
    <button
      onClick={onToggle}
      className={`
        relative rounded-full flex items-center justify-center transition-all duration-200
        ${getSizeClasses()} ${getVariantClasses()}
        ${isListening ? 'animate-pulse' : 'hover:scale-105'}
      `}
      aria-label={isListening ? 'Stop listening' : 'Start voice input'}
    >
      <FontAwesomeIcon icon={isListening ? faTimes : faMicrophone} className={getIconSize()} />

      {/* Active indicator */}
      {isListening && (
        <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-25"></div>
      )}
    </button>
  );
}
