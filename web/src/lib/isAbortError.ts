export function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'name' in err && (err as { name?: unknown }).name === 'AbortError');
}
