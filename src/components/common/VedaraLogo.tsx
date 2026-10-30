import React from 'react';

interface VedaraLogoProps {
  size?: number;
  className?: string;
  /** `brand`: light V with the saffron cursor, for dark surfaces. `monochrome`: both parts in currentColor. */
  variant?: 'brand' | 'monochrome';
}

/**
 * The Vedara mark: a V-shaped prompt chevron above a cursor bar.
 * Geometry matches branding/vedara-glyph.svg.
 */
export const VedaraLogo: React.FC<VedaraLogoProps> = ({
  size = 18,
  className = '',
  variant = 'brand',
}) => {
  const isBrand = variant === 'brand';

  return (
    <svg
      viewBox="20 20 60 60"
      width={size}
      height={size}
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path
        d="M29 30 L50 54 L71 30"
        fill="none"
        stroke={isBrand ? '#f8fafc' : 'currentColor'}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x={37} y={67} width={26} height={9} rx={2.5} fill={isBrand ? '#F59E0B' : 'currentColor'} />
    </svg>
  );
};
