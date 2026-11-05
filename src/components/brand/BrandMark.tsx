// LedgerVault — the Lumen brand mark.
//
// A single gradient tile: an implied ledger staircase drawn in white, with a mint certainty dot at
// the upper right. It is deliberately geometric so it stays legible at 20px in the rail and at 44px
// in the expanded sidebar, and it needs no raster asset.

export interface BrandMarkProps {
  size?: number;
  className?: string;
  /** Disable the resting glow for dense chrome (print, rail, subtle placements). */
  glow?: boolean;
  title?: string;
}

export function BrandMark({
  size = 38,
  className = '',
  glow = true,
  title = 'LedgerVault',
}: BrandMarkProps) {
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[13px] brand-gradient ring-1 ring-white/20 ${
        glow ? 'shadow-lift' : 'shadow-sm'
      } ${className}`}
      style={{ height: size, width: size }}
      role="img"
      aria-label={title}
    >
      {/* Faint engineering grid, clipped inside the tile. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)',
          backgroundSize: `${Math.max(7, size / 4.8)}px ${Math.max(7, size / 4.8)}px`,
          maskImage: 'radial-gradient(circle at 30% 20%, black, transparent 82%)',
          WebkitMaskImage: 'radial-gradient(circle at 30% 20%, black, transparent 82%)',
        }}
      />
      {/* Top-edge specular highlight. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-white/70 to-transparent"
      />
      <svg
        viewBox="0 0 40 40"
        width={size * 0.66}
        height={size * 0.66}
        aria-hidden
        className="relative z-10 drop-shadow-[0_1px_2px_rgba(10,10,30,0.25)]"
      >
        <rect x="10.5" y="9.5" width="4.7" height="21.5" rx="2.35" fill="#ffffff" fillOpacity="0.97" />
        <rect x="10.5" y="26.3" width="16.4" height="4.7" rx="2.35" fill="#ffffff" fillOpacity="0.97" />
        <rect x="18.7" y="18.9" width="10.1" height="4.3" rx="2.15" fill="#ffffff" fillOpacity="0.46" />
        <circle cx="30.9" cy="10.4" r="2.7" fill="#6ee7b7" />
        <circle cx="30.9" cy="10.4" r="4.6" fill="none" stroke="#6ee7b7" strokeOpacity="0.32" strokeWidth="1" />
      </svg>
    </span>
  );
}

export default BrandMark;
