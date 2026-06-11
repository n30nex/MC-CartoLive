export default function PanelSkeleton() {
  return (
    <div className="panel-skeleton" aria-label="Loading">
      <div className="skeleton-header shimmer" />
      <div className="skeleton-row shimmer" />
      <div className="skeleton-row shimmer" style={{ animationDelay: '0.1s' }} />
      <div className="skeleton-row shimmer" style={{ animationDelay: '0.2s' }} />
      <div className="skeleton-row shimmer" style={{ animationDelay: '0.3s' }} />
      <div className="skeleton-row shimmer" style={{ animationDelay: '0.4s' }} />
    </div>
  );
}
