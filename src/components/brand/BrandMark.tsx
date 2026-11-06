import { BRAND_NAME, FintuityMark } from './FintuityBrand';

export interface BrandMarkProps {
  size?: number;
  className?: string;
  /** Disable the resting glow for dense chrome (print, rail, subtle placements). */
  glow?: boolean;
  title?: string;
}

/** Demo-shell compatibility wrapper around the compact Fintuity mark. */
export function BrandMark({ size = 38, className = '', glow = true, title = BRAND_NAME }: BrandMarkProps) {
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[13px] ${
        glow ? 'fintuity-mark-glow' : 'shadow-sm'
      } ${className}`}
      style={{ height: size, width: size }}
    >
      <FintuityMark size={size} title={title} />
    </span>
  );
}

export default BrandMark;
