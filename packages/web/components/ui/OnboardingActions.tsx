'use client';
import React from 'react';

export interface OnboardingActionsProps {
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export const OnboardingActions: React.FC<OnboardingActionsProps> = ({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  loading = false,
  disabled = false,
}) => {
  return (
    <div className="flex items-center gap-3">
      <button
        className="btn btn-accent ring-hover focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
        onClick={onPrimary}
        disabled={disabled || loading}
      >
        {loading && <span className="loading loading-spinner loading-xs mr-2" />} {primaryLabel}
      </button>
      {secondaryLabel && onSecondary && (
        <button className="btn btn-outline" onClick={onSecondary} disabled={disabled}>
          {secondaryLabel}
        </button>
      )}
    </div>
  );
};

export default OnboardingActions;
