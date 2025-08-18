// ABOUTME: Native browser speech recognition component with visual feedback and error handling.

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faStop } from '@/lib/fontawesome';
import { WaveformIcon } from './WaveformIcon';

interface NativeSpeechInputProps {
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'idle' | 'listening' | 'processing' | 'error') => void;
  onAudioLevel?: (level: number) => void; // New callback for audio levels
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'ghost' | 'outline';
  autoStart?: boolean;
  continuous?: boolean;
  interimResults?: boolean;
  language?: string;
  forceStop?: boolean; // Add prop to force stop from parent
}

export function NativeSpeechInput({
  onTranscript,
  onError,
  onStatusChange,
  onAudioLevel,
  className = '',
  size = 'md',
  variant = 'ghost',
  autoStart = false,
  continuous = true,
  interimResults = true,
  language = 'en-US',
  forceStop = false,
}: NativeSpeechInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied'>(
    'unknown'
  );
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Check for Web Speech API support
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);

    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
    }
  }, []);

  // Start audio level monitoring
  const startAudioLevelMonitoring = useCallback(async () => {
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      microphoneStreamRef.current = stream;

      // Create audio context and analyser
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      microphone.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      // Monitor audio levels
      const monitorAudioLevel = () => {
        if (!analyserRef.current) return;

        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate RMS (root mean square) for more accurate volume detection
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);

        // Convert to 0-100 scale and apply some smoothing
        const level = Math.min(100, (rms / 128) * 100);

        setAudioLevel(level);
        onAudioLevel?.(level);

        if (isListening) {
          animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
        }
      };

      monitorAudioLevel();
      return true;
    } catch (error) {
      console.error('Failed to start audio monitoring:', error);
      return false;
    }
  }, [onAudioLevel, isListening]);

  // Stop audio level monitoring
  const stopAudioLevelMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
  }, []);

  // Request microphone permissions
  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach((track) => track.stop());
      setPermissionStatus('granted');
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);
      setPermissionStatus('denied');
      onError?.('Microphone permission required for voice input');
      return false;
    }
  }, [onError]);

  // Initialize speech recognition
  const initializeSpeechRecognition = useCallback(() => {
    if (!recognitionRef.current) return null;

    const recognition = recognitionRef.current;

    // Configure recognition settings
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.language = language;
    recognition.maxAlternatives = 1;

    // Handle speech recognition results
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcript;
          setConfidence(result[0].confidence || 0);
        } else {
          interimTranscript += transcript;
        }
      }

      // Update current transcript for display
      const combinedTranscript = finalTranscript || interimTranscript;
      setCurrentTranscript(combinedTranscript);

      // Send both interim and final results to parent for live updates
      if (combinedTranscript.trim()) {
        onTranscript(combinedTranscript.trim());
      }

      // Clear only after final result
      if (finalTranscript.trim()) {
        setCurrentTranscript(''); // Clear after sending final
      }
    };

    // Handle speech recognition start
    recognition.onstart = () => {
      setIsListening(true);
      onStatusChange?.('listening');
      // Start audio level monitoring when speech recognition starts
      startAudioLevelMonitoring();
    };

    // Handle speech recognition end
    recognition.onend = () => {
      setIsListening(false);
      onStatusChange?.('idle');
      setCurrentTranscript('');
      // Stop audio level monitoring when speech recognition ends
      stopAudioLevelMonitoring();
    };

    // Handle speech recognition errors
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      onStatusChange?.('error');
      // Stop audio monitoring on error
      stopAudioLevelMonitoring();

      let errorMessage = 'Voice recognition error';

      switch (event.error) {
        case 'no-speech':
          errorMessage = 'No speech detected. Try speaking closer to the microphone.';
          break;
        case 'audio-capture':
          errorMessage = 'Microphone not accessible. Please check your microphone connection.';
          break;
        case 'not-allowed':
          errorMessage = 'Microphone access denied. Please allow microphone permissions.';
          setPermissionStatus('denied');
          break;
        case 'network':
          errorMessage = 'Network error during voice recognition.';
          break;
        case 'service-not-allowed':
          errorMessage = 'Voice recognition service not available.';
          break;
        default:
          errorMessage = `Voice recognition error: ${event.error}`;
      }

      onError?.(errorMessage);
    };

    return recognition;
  }, [
    continuous,
    interimResults,
    language,
    onTranscript,
    onError,
    onStatusChange,
    startAudioLevelMonitoring,
    stopAudioLevelMonitoring,
  ]);

  // Start voice recognition
  const startListening = useCallback(async () => {
    if (!isSupported) {
      onError?.('Speech recognition is not supported in this browser');
      return;
    }

    if (isListening) return;

    // Request permission first
    if (permissionStatus !== 'granted') {
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) return;
    }

    try {
      const recognition = initializeSpeechRecognition();
      if (!recognition) return;

      onStatusChange?.('processing');
      recognition.start();

      // Set a timeout to auto-stop after a reasonable time
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, 30000); // Stop after 30 seconds
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      onError?.('Failed to start voice recognition');
      onStatusChange?.('error');
    }
  }, [
    isSupported,
    isListening,
    permissionStatus,
    requestMicrophonePermission,
    initializeSpeechRecognition,
    onError,
    onStatusChange,
  ]);

  // Stop voice recognition
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Stop audio monitoring
    stopAudioLevelMonitoring();
  }, [isListening, stopAudioLevelMonitoring]);

  // Auto-start if requested
  useEffect(() => {
    if (autoStart && isSupported && !isListening) {
      startListening();
    }
  }, [autoStart, isSupported, isListening, startListening]);

  // Handle force stop from parent
  useEffect(() => {
    if (forceStop && isListening) {
      stopListening();
    }
  }, [forceStop, isListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (recognitionRef.current && isListening) {
        recognitionRef.current.stop();
      }
      // Clean up audio monitoring
      stopAudioLevelMonitoring();
    };
  }, [isListening, stopAudioLevelMonitoring]);

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const getSizeClasses = () => {
    // Allow className to override if it contains width/height
    if (className && (className.includes('w-') || className.includes('h-'))) {
      return '';
    }

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
      return 'bg-success hover:bg-success text-success-content shadow-lg';
    }

    switch (variant) {
      case 'primary':
        return 'bg-primary hover:bg-primary-focus text-primary-content';
      case 'ghost':
        return 'bg-transparent hover:bg-neutral-700 text-neutral-400 hover:text-neutral-300';
      case 'outline':
        return 'border border-base-300 hover:bg-base-200 text-base-content';
      default:
        return 'bg-transparent hover:bg-neutral-700 text-neutral-400 hover:text-neutral-300';
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

  // Don't render if not supported
  if (!isSupported) {
    return null;
  }

  return (
    <div className="relative">
      <div className="relative">
        {/* Pulsing background circle when listening */}
        {isListening && (
          <div className="absolute inset-0 bg-success rounded-full animate-pulse opacity-30"></div>
        )}

        <button
          onClick={handleClick}
          disabled={permissionStatus === 'denied'}
          className={`
            relative flex items-center justify-center transition-all duration-200
            ${className || `rounded-full ${getSizeClasses()} ${getVariantClasses()}`}
            ${isListening ? 'scale-110' : 'hover:scale-105'}
            disabled:opacity-50 disabled:cursor-not-allowed z-10
          `}
          aria-label={
            permissionStatus === 'denied'
              ? 'Microphone access denied'
              : isListening
                ? 'Stop dictation'
                : 'Start voice dictation'
          }
          title={
            permissionStatus === 'denied'
              ? 'Please enable microphone permissions in your browser settings'
              : isListening
                ? `Stop dictation (${Math.round(confidence * 100)}% confidence)`
                : 'Click to start voice dictation'
          }
        >
          <WaveformIcon
            className={className && className.includes('w-') ? 'w-5 h-5' : getIconSize()}
            audioLevel={audioLevel}
            isActive={isListening}
          />

          {/* Permission denied indicator */}
          {permissionStatus === 'denied' && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
          )}
        </button>

        {/* Remove live transcript display - let it show in input instead */}
      </div>
    </div>
  );
}

// Hook for managing speech recognition state
export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'error'>('idle');
  const [audioLevel, setAudioLevel] = useState(0);

  const handleTranscript = useCallback((text: string) => {
    setTranscript(text); // Don't accumulate, just set the current text for live updates
  }, []);

  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const handleStatusChange = useCallback(
    (newStatus: 'idle' | 'listening' | 'processing' | 'error') => {
      setStatus(newStatus);
      setIsListening(newStatus === 'listening');

      if (newStatus === 'idle') {
        setError(null);
        setAudioLevel(0); // Reset audio level when idle
      }
    },
    []
  );

  const handleAudioLevel = useCallback((level: number) => {
    setAudioLevel(level);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    transcript,
    isListening,
    error,
    status,
    audioLevel,
    handleTranscript,
    handleError,
    handleStatusChange,
    handleAudioLevel,
    clearTranscript,
    clearError,
  };
}
