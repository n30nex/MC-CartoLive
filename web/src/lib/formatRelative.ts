export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const deltaMs = now - timestamp;
  const seconds = Math.max(1, Math.floor(deltaMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
