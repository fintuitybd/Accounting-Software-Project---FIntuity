// LedgerVault — Phase 6 vector identity system.
//
// Four hand-built, fully vector marks that carry the visual language of the product without any
// raster asset: the prismatic vault crest, the Jamdani lattice watermark, the multi-concentric
// compliance rings and the cryptographic seal. All geometry is deterministic SVG; motion is
// governed by the app-wide FULL / LITE / OFF tier, never by system timers.

import { useEffect, useId, useState, type CSSProperties } from 'react';

export type MotionTier = 'FULL' | 'LITE' | 'OFF';

// ---------------------------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------------------------

const clampPct = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const safeId = (raw: string): string => raw.replace(/[^a-zA-Z0-9_-]/g, '');

/** Point on a circle, 0° = 12 o'clock, clockwise. */
function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

// ---------------------------------------------------------------------------------------------
// 1. LedgerVault crest — prismatic indigo & violet vault emblem
// ---------------------------------------------------------------------------------------------

const CREST_SPOKES = Array.from({ length: 8 }, (_, index) => {
  const angle = index * 45;
  const inner = polar(60, 60, 13.5, angle);
  const outer = polar(60, 60, 26.5, angle);
  return { key: index, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

const CREST_RIVETS = Array.from({ length: 12 }, (_, index) => polar(60, 60, 29.5, index * 30));

export function LedgerVaultCrestSvg({
  className,
  size = 64,
  title = 'LedgerVault vault crest',
}: {
  className?: string;
  size?: number;
  title?: string;
}) {
  const uid = safeId(useId());

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <radialGradient id={`${uid}-aura`} cx="50%" cy="46%" r="55%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.55" />
          <stop offset="62%" stopColor="#4f46e5" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#08080f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5f3ff" />
          <stop offset="34%" stopColor="#d8b4fe" />
          <stop offset="68%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6b21a8" />
        </linearGradient>
        <linearGradient id={`${uid}-facet-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id={`${uid}-facet-b`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#151332" />
        </linearGradient>
        <linearGradient id={`${uid}-facet-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c084fc" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#6b21a8" stopOpacity="0.32" />
        </linearGradient>
        <radialGradient id={`${uid}-door`} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="58%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#08080f" />
        </radialGradient>
        <clipPath id={`${uid}-shield`}>
          <path d="M60 10.5 102.5 33.5V77L60 109.5 17.5 77V33.5Z" />
        </clipPath>
      </defs>

      <circle cx="60" cy="60" r="58" fill={`url(#${uid}-aura)`} />

      {/* Shield outline */}
      <path
        d="M60 4 108 30v52L60 116 12 82V30Z"
        fill="#08080f"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M60 10.5 102.5 33.5V77L60 109.5 17.5 77V33.5Z"
        fill="none"
        stroke="#e9d5ff"
        strokeOpacity="0.32"
        strokeWidth="0.9"
      />

      {/* Prismatic facets */}
      <g clipPath={`url(#${uid}-shield)`}>
        <path d="M17.5 33.5 60 10.5 60 60Z" fill={`url(#${uid}-facet-b)`} />
        <path d="M60 10.5 102.5 33.5 60 60Z" fill={`url(#${uid}-facet-a)`} opacity="0.9" />
        <path d="M102.5 33.5V77L60 60Z" fill={`url(#${uid}-facet-gold)`} />
        <path d="M102.5 77 60 109.5 60 60Z" fill="#151332" />
        <path d="M60 109.5 17.5 77 60 60Z" fill="#312e81" />
        <path d="M17.5 77V33.5L60 60Z" fill={`url(#${uid}-facet-a)`} opacity="0.7" />
        <path d="M17.5 33.5 60 60 102.5 33.5" fill="none" stroke="#e9d5ff" strokeOpacity="0.22" strokeWidth="0.8" />
        <path d="M17.5 77 60 60 102.5 77" fill="none" stroke="#e9d5ff" strokeOpacity="0.18" strokeWidth="0.8" />
      </g>

      {/* Vault door */}
      <circle cx="60" cy="60" r="31.5" fill="#08080f" stroke={`url(#${uid}-gold)`} strokeWidth="1.8" />
      <circle
        cx="60"
        cy="60"
        r="26"
        fill="none"
        stroke="#a5b4fc"
        strokeOpacity="0.38"
        strokeWidth="0.85"
        strokeDasharray="1 3"
      />
      <g stroke="#a855f7" strokeWidth="0.9" strokeOpacity="0.7" strokeLinecap="round">
        {CREST_SPOKES.map((spoke) => (
          <line key={spoke.key} x1={spoke.x1} y1={spoke.y1} x2={spoke.x2} y2={spoke.y2} />
        ))}
      </g>
      <g fill="#e9d5ff" fillOpacity="0.8">
        {CREST_RIVETS.map((rivet, index) => (
          <circle key={index} cx={rivet.x} cy={rivet.y} r="1.05" />
        ))}
      </g>
      <circle cx="60" cy="60" r="13.2" fill={`url(#${uid}-door)`} stroke="#e9d5ff" strokeWidth="1" />
      <circle cx="60" cy="56.8" r="3.6" fill={`url(#${uid}-gold)`} />
      <path d="M57.7 59.4 62.3 59.4 63.5 68.4 56.5 68.4Z" fill={`url(#${uid}-gold)`} />

      {/* Crown gem */}
      <path d="M60 0.6 64.6 7 60 13.4 55.4 7Z" fill={`url(#${uid}-gold)`} stroke="#08080f" strokeWidth="0.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Jamdani watermark — crisp geometric lattice, tuned for faint print and card placement
// ---------------------------------------------------------------------------------------------

const JAMDANI_TONES = {
  ink: '#0b0b16',
  emerald: '#4f46e5',
  gold: '#a855f7',
  white: '#ffffff',
} as const;

const JAMDANI_PETALS = Array.from({ length: 8 }, (_, index) => index * 45);

export function JamdaniWatermarkSvg({
  className,
  opacity = 0.06,
  tone = 'ink',
  title,
  preserveAspectRatio = 'xMidYMid slice',
}: {
  className?: string;
  opacity?: number;
  tone?: keyof typeof JAMDANI_TONES;
  title?: string;
  preserveAspectRatio?: string;
}) {
  const uid = safeId(useId());
  const color = JAMDANI_TONES[tone];

  return (
    <svg
      viewBox="0 0 720 1000"
      preserveAspectRatio={preserveAspectRatio}
      className={className}
      style={{ opacity }}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      shapeRendering="geometricPrecision"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <pattern id={`${uid}-jamdani`} width="96" height="96" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={color} strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round">
            {/* Diagonal lattice, the structural grid of a Jamdani sari */}
            <path d="M0 0 96 96M96 0 0 96" strokeOpacity="0.4" />
            {/* Diamond lozenges */}
            <path d="M48 5 91 48 48 91 5 48Z" strokeOpacity="0.55" />
            <path d="M48 19 77 48 48 77 19 48Z" strokeOpacity="0.34" />
            <path d="M48 31 65 48 48 65 31 48Z" strokeOpacity="0.24" />
            {/* Corduroy couching lines at the tile edge */}
            <path d="M0 22 22 0M0 74 22 96M96 22 74 0M96 74 74 96" strokeOpacity="0.28" />
            {/* Edge buti diamonds */}
            <path d="M48 0 54 6 48 12 42 6Z" strokeOpacity="0.45" />
            <path d="M48 84 54 90 48 96 42 90Z" strokeOpacity="0.45" />
            <path d="M0 48 6 42 12 48 6 54Z" strokeOpacity="0.45" />
            <path d="M84 48 90 42 96 48 90 54Z" strokeOpacity="0.45" />
            {/* Eight-petal buti */}
            {JAMDANI_PETALS.map((angle) => (
              <ellipse
                key={angle}
                cx="48"
                cy="41.2"
                rx="2.35"
                ry="6.3"
                transform={`rotate(${angle} 48 48)`}
                strokeOpacity="0.5"
              />
            ))}
          </g>
          <g fill={color}>
            <circle cx="48" cy="48" r="2.1" fillOpacity="0.9" />
            <circle cx="24" cy="24" r="1.15" fillOpacity="0.5" />
            <circle cx="72" cy="24" r="1.15" fillOpacity="0.5" />
            <circle cx="24" cy="72" r="1.15" fillOpacity="0.5" />
            <circle cx="72" cy="72" r="1.15" fillOpacity="0.5" />
          </g>
        </pattern>
      </defs>
      <rect width="720" height="1000" fill={`url(#${uid}-jamdani)`} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Compliance rings — four concentric stroke-dashoffset progress rings
// ---------------------------------------------------------------------------------------------

const RING_SIZE = 240;
const RING_CENTER = RING_SIZE / 2;
const RING_OUTER_RADIUS = 92;
const RING_STEP = 18;
const RING_STROKE = 8.5;

const RING_TICKS = Array.from({ length: 60 }, (_, index) => {
  const angle = index * 6;
  const outer = polar(RING_CENTER, RING_CENTER, 103, angle);
  const inner = polar(RING_CENTER, RING_CENTER, index % 5 === 0 ? 96 : 99, angle);
  return { key: index, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major: index % 5 === 0 };
});

export interface ComplianceRingItem {
  id: string;
  /** Short marker, e.g. "VAT". */
  label: string;
  /** Full statutory name for screen readers and legends. */
  caption?: string;
  /** 0–100. */
  value: number;
  /** Any CSS colour; the arc fades from this tone into gold. */
  tone: string;
  hint?: string;
}

export interface ComplianceRingsSvgProps {
  items: ReadonlyArray<ComplianceRingItem>;
  size?: number;
  motionTier?: MotionTier;
  centerValue?: string;
  centerLabel?: string;
  centerHint?: string;
  className?: string;
  /** When supplied, each ring becomes a keyboard-accessible drill-down. */
  onSelect?: (id: string) => void;
}

export function ComplianceRingsSvg({
  items,
  size = RING_SIZE,
  motionTier = 'FULL',
  centerValue,
  centerLabel = 'Readiness',
  centerHint,
  className,
  onSelect,
}: ComplianceRingsSvgProps) {
  const uid = safeId(useId());
  const rings = items.slice(0, 4);
  const [armed, setArmed] = useState(motionTier === 'OFF');
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    if (motionTier === 'OFF') {
      setArmed(true);
      return;
    }
    setArmed(false);
    const frame = window.requestAnimationFrame(() => setArmed(true));
    return () => window.cancelAnimationFrame(frame);
  }, [motionTier]);

  const average = rings.length
    ? Math.round(rings.reduce((sum, ring) => sum + clampPct(ring.value), 0) / rings.length)
    : 0;

  const animationMs = motionTier === 'FULL' ? 1150 : motionTier === 'LITE' ? 380 : 0;
  const heading = rings.map((ring) => `${ring.label} ${Math.round(clampPct(ring.value))}%`).join(' · ');
  const activeId = hovered ?? focused;
  const activeRing = rings.find((ring) => ring.id === activeId) ?? null;

  return (
    <svg
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`Compliance readiness rings${heading ? ` — ${heading}` : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      onMouseLeave={() => setHovered(null)}
    >
      <title>{`Compliance readiness — ${heading || 'no signals'}`}</title>
      <defs>
        {rings.map((ring, index) => (
          <linearGradient key={ring.id} id={`${uid}-ring-${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ring.tone} />
            <stop offset="58%" stopColor={ring.tone} stopOpacity="0.94" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        ))}
        <radialGradient id={`${uid}-core`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="rgb(var(--lv-surface))" />
          <stop offset="100%" stopColor="rgb(var(--lv-surface-2))" />
        </radialGradient>
      </defs>

      {/* Engraved tick ring */}
      <g strokeWidth="0.8" strokeLinecap="round" style={{ stroke: 'rgb(var(--lv-line))' }}>
        {RING_TICKS.map((tick) => (
          <line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            style={tick.major ? { stroke: 'rgb(var(--lv-saffron))', strokeOpacity: 0.5 } : { strokeOpacity: 0.9 }}
          />
        ))}
      </g>

      {rings.map((ring, index) => {
        const radius = RING_OUTER_RADIUS - index * RING_STEP;
        const circumference = 2 * Math.PI * radius;
        const targetOffset = circumference * (1 - clampPct(ring.value) / 100);
        const offset = armed ? targetOffset : circumference;
        const isActive = activeId === ring.id;
        const isDimmed = Boolean(activeId) && !isActive;
        const style: CSSProperties = {
          strokeDashoffset: offset,
          transition:
            animationMs === 0
              ? 'none'
              : `stroke-dashoffset ${animationMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${
                  motionTier === 'FULL' ? index * 90 : 0
                }ms, opacity 180ms ease, stroke-width 180ms ease`,
        };

        return (
          <g
            key={ring.id}
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={
              onSelect
                ? `${ring.label} ${Math.round(clampPct(ring.value))}% — open ${ring.caption ?? ring.label}`
                : `${ring.label} ${Math.round(clampPct(ring.value))}%`
            }
            className={onSelect ? 'cursor-pointer outline-none' : undefined}
            style={{ opacity: isDimmed ? 0.38 : 1, transition: 'opacity 180ms ease' }}
            onMouseEnter={() => setHovered(ring.id)}
            onFocus={() => setFocused(ring.id)}
            onBlur={() => setFocused(null)}
            onClick={() => onSelect?.(ring.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(ring.id);
              }
            }}
          >
            <circle cx={RING_CENTER} cy={RING_CENTER} r={radius} fill="none" style={{ stroke: 'rgb(var(--lv-line))' }} strokeWidth={RING_STROKE} />
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={radius}
              fill="none"
              stroke={`url(#${uid}-ring-${index})`}
              strokeWidth={isActive ? RING_STROKE + 2.6 : RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              style={style}
            />
            {/* Generous invisible hit target, including the arc gap. */}
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={radius}
              fill="none"
              stroke="transparent"
              strokeWidth={RING_STROKE + 12}
              pointerEvents={onSelect ? 'stroke' : 'none'}
            />
          </g>
        );
      })}

      <circle cx={RING_CENTER} cy={RING_CENTER} r="35" fill={`url(#${uid}-core)`} style={{ stroke: 'rgb(var(--lv-line))' }} strokeWidth="0.9" />
      <text
        x={RING_CENTER}
        y={RING_CENTER + 2}
        textAnchor="middle"
        fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
        fontSize={activeRing ? '23' : '29'}
        fontWeight="600"
        letterSpacing="-0.04em"
        className="fill-ink-900"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {activeRing ? `${Math.round(clampPct(activeRing.value))}%` : centerValue ?? `${average}%`}
      </text>
      <text
        x={RING_CENTER}
        y={RING_CENTER + 19}
        textAnchor="middle"
        fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
        fontSize="7.4"
        fontWeight="600"
        letterSpacing="1.5"
        className="fill-ink-500"
      >
        {(activeRing ? activeRing.label : centerLabel).toUpperCase()}
      </text>
      {centerHint ? (
        <text
          x={RING_CENTER}
          y={RING_CENTER + 30}
          textAnchor="middle"
          fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif"
          fontSize="6.2"
          className="fill-ink-400"
        >
          {activeRing ? activeRing.hint ?? '' : centerHint}
        </text>
      ) : null}

      {/* Direct legend affordance on the ring itself */}
      {onSelect
        ? rings.map((ring, index) => {
            const angle = -62 + index * 47;
            const point = polar(RING_CENTER, RING_CENTER, RING_OUTER_RADIUS + 10.5, angle);
            return (
              <circle
                key={`dot-${ring.id}`}
                cx={point.x}
                cy={point.y}
                r={activeId === ring.id ? 2.6 : 1.7}
                fill={ring.tone}
                opacity={activeId && activeId !== ring.id ? 0.4 : 0.95}
                style={{ transition: 'r 160ms ease, opacity 160ms ease' }}
              />
            );
          })
        : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Cryptographic seal — SHA-256 audit chain / locked period verification emblem
// ---------------------------------------------------------------------------------------------

const SEAL_RADIUS = 80;
const SEAL_TICKS = Array.from({ length: 48 }, (_, index) => {
  const angle = index * 7.5;
  const outer = polar(SEAL_RADIUS, SEAL_RADIUS, 69, angle);
  const inner = polar(SEAL_RADIUS, SEAL_RADIUS, index % 4 === 0 ? 63.5 : 66, angle);
  return { key: index, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major: index % 4 === 0 };
});

export function CryptographicSealSvg({
  className,
  size = 120,
  variant = 'audit',
  verified = true,
  label,
}: {
  className?: string;
  size?: number;
  variant?: 'audit' | 'locked';
  verified?: boolean;
  label?: string;
}) {
  const uid = safeId(useId());
  const locked = variant === 'locked';
  const accent = verified ? '#10b981' : '#e11d48';
  const caption = locked ? 'PERIOD LOCKED' : verified ? 'SHA-256 VERIFIED' : 'CHAIN REVIEW';
  const ariaLabel = label ?? (locked ? 'Locked accounting period seal' : 'SHA-256 audit chain seal');

  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{ariaLabel}</title>
      <defs>
        <radialGradient id={`${uid}-field`} cx="42%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="52%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#08080f" />
        </radialGradient>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5f3ff" />
          <stop offset="42%" stopColor="#d8b4fe" />
          <stop offset="72%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6b21a8" />
        </linearGradient>
      </defs>

      <circle cx="80" cy="80" r="76" fill="#08080f" />
      <circle cx="80" cy="80" r="75" fill="none" stroke={`url(#${uid}-gold)`} strokeWidth="2.1" />
      <circle cx="80" cy="80" r="70.5" fill="none" stroke="#e9d5ff" strokeOpacity="0.34" strokeWidth="0.7" />

      <g strokeLinecap="round">
        {SEAL_TICKS.map((tick) => (
          <line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tick.major ? '#e9d5ff' : '#818cf8'}
            strokeOpacity={tick.major ? 0.6 : 0.32}
            strokeWidth={tick.major ? 1 : 0.65}
          />
        ))}
      </g>

      <circle cx="80" cy="80" r="58" fill={`url(#${uid}-field)`} stroke="#a855f7" strokeWidth="0.9" />
      <circle
        cx="80"
        cy="80"
        r="50.5"
        fill="none"
        stroke="#e9d5ff"
        strokeOpacity="0.26"
        strokeWidth="0.7"
        strokeDasharray="1.6 4"
      />
      <circle cx="80" cy="80" r="45" fill="none" stroke="#818cf8" strokeOpacity="0.18" strokeWidth="0.6" />

      <text
        x="80"
        y="44"
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="6.4"
        letterSpacing="1.5"
        fill="#c7d2fe"
        fillOpacity="0.85"
      >
        LEDGERVAULT
      </text>

      {locked ? (
        <g>
          <rect
            x="67"
            y="71"
            width="26"
            height="21"
            rx="3"
            fill="#08080f"
            fillOpacity="0.6"
            stroke={`url(#${uid}-gold)`}
            strokeWidth="1.4"
          />
          <path
            d="M73.5 71V65.5a6.5 6.5 0 0 1 13 0V71"
            fill="none"
            stroke="#e9d5ff"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="80" cy="79.5" r="2.2" fill="#e9d5ff" />
          <path d="M79 81.5 81 81.5 81.8 87 78.2 87Z" fill="#e9d5ff" />
        </g>
      ) : (
        <g>
          <path
            d="M80 51 97 58.4v13.8c0 10.2-7.2 18.4-17 22.4-9.8-4-17-12.2-17-22.4V58.4Z"
            fill="#08080f"
            fillOpacity="0.6"
            stroke={`url(#${uid}-gold)`}
            strokeWidth="1.4"
          />
          <path
            d="M71 73.5 77.5 80 89.5 66.5"
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      <text
        x="80"
        y="126"
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="7.4"
        letterSpacing="1.1"
        fill="#e9d5ff"
      >
        {caption}
      </text>
    </svg>
  );
}

export default {
  LedgerVaultCrestSvg,
  JamdaniWatermarkSvg,
  ComplianceRingsSvg,
  CryptographicSealSvg,
};
