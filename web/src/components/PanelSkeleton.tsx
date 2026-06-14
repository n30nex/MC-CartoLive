import { LoadingBlock } from './LoadingPrimitives';

interface PanelSkeletonProps {
  title?: string;
  message?: string;
  rows?: number;
}

export default function PanelSkeleton({
  title = 'Loading panel',
  message = 'Preparing this workspace.',
  rows = 5
}: PanelSkeletonProps) {
  return (
    <LoadingBlock
      variant="panel"
      title={title}
      message={message}
      rows={rows}
      className="panel-skeleton"
    />
  );
}
