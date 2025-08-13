import React from 'react';
import clsx from 'clsx';

interface VaporBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  intensity?: 'soft' | 'normal' | 'strong';
}

export function VaporBackground({
  className,
  intensity = 'normal',
  ...rest
}: VaporBackgroundProps) {
  return (
    <div
      aria-hidden
      {...rest}
      className={clsx('vapor-bg pointer-events-none fixed inset-0 -z-10', className)}
    >
      <div
        className={clsx(
          'absolute inset-0',
          intensity === 'soft' && 'opacity-60',
          intensity === 'normal' && 'opacity-80',
          intensity === 'strong' && 'opacity-100'
        )}
        style={{
          backgroundImage:
            'radial-gradient(1200px 700px at 15% -10%, rgba(34,197,94,.14), transparent 60%),\
             radial-gradient(1000px 600px at 85% 0%, rgba(59,130,246,.10), transparent 60%),\
             linear-gradient(180deg, #0b0f0e, #121614)',
        }}
      />
      <div
        className="sunlines absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(255,105,180,.10) 0 8px, transparent 8px 22px)',
        }}
      />
      <div className="noise absolute inset-0 opacity-35 mix-blend-overlay" />
      <style>
        {`
        .noise::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:url("data:image/svg+xml;utf8,\
          <svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>\
            <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .06 0'/></filter>\
            <rect width='100%' height='100%' filter='url(%23n)'/>\
          </svg>");background-size:220px 220px;}`}
      </style>
    </div>
  );
}
