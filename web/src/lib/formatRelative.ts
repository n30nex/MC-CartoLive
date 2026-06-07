export function formatRelative(at: number, now = Date.now()): string {
  const age = Math.max(0, now - at);
  if (age < 60_000) return `${Math.max(1, Math.round(age / 1000))}s ago`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  return `${Math.round(age / 3_600_000)}h ago`;
}
