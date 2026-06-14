import { LoaderCircle } from 'lucide-react';
import { activeAssetPack } from '../assets/v3/assetPacks';

export type LoadingSpinnerSize = 'sm' | 'md' | 'lg';
export type LoadingBlockVariant = 'inline' | 'panel' | 'map';

interface LoadingSpinnerProps {
  size?: LoadingSpinnerSize;
  branded?: boolean;
  label?: string;
  decorative?: boolean;
  className?: string;
}

interface LoadingBlockProps {
  variant?: LoadingBlockVariant;
  title: string;
  message?: string;
  rows?: number;
  branded?: boolean;
  className?: string;
}

interface LoadingRowsProps {
  count?: number;
  compact?: boolean;
  className?: string;
}

interface LoadingButtonLabelProps {
  loading: boolean;
  label: string;
  loadingLabel?: string;
}

export function LoadingSpinner({
  size = 'md',
  branded = false,
  label = 'Loading',
  decorative = false,
  className = ''
}: LoadingSpinnerProps) {
  const ariaProps = decorative ? { 'aria-hidden': true as const } : { role: 'status' as const, 'aria-label': label };
  return (
    <span className={`loading-spinner loading-spinner-${size} ${branded ? 'branded' : ''} ${className}`.trim()} {...ariaProps}>
      <LoaderCircle size={spinnerIconSize(size)} aria-hidden="true" />
      {branded && <img src={activeAssetPack.brand.loadingMark} alt="" aria-hidden="true" />}
    </span>
  );
}

export function LoadingBlock({
  variant = 'panel',
  title,
  message,
  rows = 0,
  branded = true,
  className = ''
}: LoadingBlockProps) {
  return (
    <div className={`loading-block loading-block-${variant} ${className}`.trim()} role="status" aria-live="polite">
      <LoadingSpinner size={variant === 'inline' ? 'sm' : 'md'} branded={branded} decorative />
      <span className="loading-block-copy">
        <strong>{title}</strong>
        {message && <em>{message}</em>}
      </span>
      {rows > 0 && <LoadingRows count={rows} compact={variant === 'inline'} />}
    </div>
  );
}

export function LoadingRows({ count = 4, compact = false, className = '' }: LoadingRowsProps) {
  return (
    <div className={`loading-rows ${compact ? 'compact' : ''} ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="loading-row shimmer" style={{ animationDelay: `${index * 0.08}s` }} />
      ))}
    </div>
  );
}

export function LoadingButtonLabel({ loading, label, loadingLabel }: LoadingButtonLabelProps) {
  return (
    <span className="loading-button-label">
      {loading && <LoadingSpinner size="sm" decorative className="loading-button-spinner" />}
      <span>{loading ? loadingLabel ?? label : label}</span>
    </span>
  );
}

function spinnerIconSize(size: LoadingSpinnerSize): number {
  if (size === 'lg') return 24;
  if (size === 'sm') return 14;
  return 18;
}
