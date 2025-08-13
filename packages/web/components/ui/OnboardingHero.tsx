'use client';
import React from 'react';

export interface OnboardingHeroProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  docsHref?: string;
  className?: string;
}

export const OnboardingHero: React.FC<OnboardingHeroProps> = ({
  title,
  subtitle,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  docsHref,
  className = '',
}) => {
  return (
    <div className={['glass ring-hover p-8', className].join(' ')}>
      <div className="text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white">{title}</h2>
          {subtitle && <p className="py-4 text-white/85">{subtitle}</p>}
          <div className="flex items-center justify-center gap-3">
            <button
              className="btn btn-accent ring-hover focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
              onClick={onPrimary}
            >
              {primaryLabel}
            </button>
            {secondaryLabel && onSecondary && (
              <button
                className="btn btn-outline border-white/20 text-white hover:border-white/40 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                onClick={onSecondary}
              >
                {secondaryLabel}
              </button>
            )}
            {docsHref && (
              <a
                className="btn btn-outline border-white/20 text-white hover:border-white/40 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                href={docsHref}
                target="_blank"
                rel="noreferrer"
              >
                View docs
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingHero;
