// ABOUTME: Visual waveform icon that reflects audio level/activity state for speech input UI.

import React from 'react';

interface WaveformIconProps {
  className?: string;
  audioLevel?: number;
  isActive?: boolean;
}

export function WaveformIcon({
  className = 'w-4 h-4',
  audioLevel = 0,
  isActive = false,
}: WaveformIconProps) {
  // Calculate opacity based on audio level for pulsing effect
  const baseOpacity = isActive ? 0.6 : 1;
  const pulseIntensity = isActive && audioLevel > 0 ? Math.min(0.4, (audioLevel / 100) * 0.4) : 0;
  const finalOpacity = baseOpacity + pulseIntensity;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 640"
      className={className}
      aria-hidden="true"
      role="presentation"
      style={{
        opacity: finalOpacity,
        transition: isActive ? 'opacity 0.1s ease-out' : 'fill 0.2s ease-out',
      }}
    >
      <path
        d="M272 68C287.5 68 300 80.5 300 96L300 544C300 559.5 287.5 572 272 572C256.5 572 244 559.5 244 544L244 96C244 80.5 256.5 68 272 68zM464 132C479.5 132 492 144.5 492 160L492 480C492 495.5 479.5 508 464 508C448.5 508 436 495.5 436 480L436 160C436 144.5 448.5 132 464 132zM176 164C191.5 164 204 176.5 204 192L204 448C204 463.5 191.5 476 176 476C160.5 476 148 463.5 148 448L148 192C148 176.5 160.5 164 176 164zM368 196C383.5 196 396 208.5 396 224L396 416C396 431.5 383.5 444 368 444C352.5 444 340 431.5 340 416L340 224C340 208.5 352.5 196 368 196zM80 260C95.5 260 108 272.5 108 288L108 352C108 367.5 95.5 380 80 380C64.5 380 52 367.5 52 352L52 288C52 272.5 64.5 260 80 260zM560 260C575.5 260 588 272.5 588 288L588 352C588 367.5 575.5 380 560 380C544.5 380 532 367.5 532 352L532 288C532 272.5 544.5 260 560 260z"
        fill={isActive ? 'rgb(16, 185, 129)' : 'currentColor'}
        style={{
          transition: 'fill 0.2s ease-out',
        }}
      />
    </svg>
  );
}
