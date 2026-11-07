/**
 * Fintuity brand primitives.
 *
 * The header lockup and the compact mark both use the supplied `logo.svg` unchanged. CSS frames crop
 * the artboard whitespace visually for the header and show the left swoosh for the rail/favicon; the
 * asset itself is never edited. Internal storage keys and API identifiers keep their historical
 * `fintuity` names so existing data and sessions are not broken by the rename.
 */

export const BRAND_NAME = 'Fintuity Accounting Suite';
export const BRAND_NAME_BN = 'ফিনটুইটি অ্যাকাউন্টিং স্যুট';

export interface FintuityLogoProps {
  height?: number;
  className?: string;
  title?: string;
}

export function FintuityLogo({ height = 52, className = '', title = BRAND_NAME }: FintuityLogoProps) {
  return (
    <span
      className={`fintuity-logo-crop select-none ${className}`}
      style={{ height, width: height * 2.8 }}
      role="img"
      aria-label={title}
    >
      <img
        src="/brand/fintuity-logo.svg"
        alt=""
        style={{ height: height * 2.05, width: 'auto', marginLeft: height * -0.28 }}
        draggable={false}
      />
    </span>
  );
}

export interface FintuityMarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function FintuityMark({ size = 36, className = '', title = BRAND_NAME }: FintuityMarkProps) {
  return (
    <span
      className={`fintuity-mark-crop select-none ${className}`}
      style={{ height: size, width: size }}
      role="img"
      aria-label={title}
    >
      <img
        src="/brand/fintuity-logo.svg"
        alt=""
        style={{ height: size * 2.05, width: 'auto' }}
        draggable={false}
      />
    </span>
  );
}

export interface FintuityLoaderProps {
  size?: number;
  label?: string;
  labelBn?: string;
  locale?: 'en-BD' | 'bn-BD';
  className?: string;
}

/** Animated brand loader used by app, route and marketing suspense boundaries. */
export function FintuityLoader({
  size = 44,
  label = 'Loading…',
  labelBn = 'লোড হচ্ছে…',
  locale = 'en-BD',
  className = '',
}: FintuityLoaderProps) {
  const text = locale === 'bn-BD' ? labelBn : label;
  return (
    <span className={`fintuity-loader ${className}`} role="status" aria-live="polite">
      <span className="fintuity-loader-art" style={{ width: size, height: size }} aria-hidden="true">
        <FintuityMark size={size} title="" />
        <span className="fintuity-loader-ring" />
      </span>
      <span className="fintuity-loader-label">{text}</span>
    </span>
  );
}

export default FintuityMark;
