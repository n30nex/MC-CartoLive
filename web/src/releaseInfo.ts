export interface RepoStats {
  stars: number;
  forks: number;
}

export interface CachedRepoStats {
  fetchedAt: number;
  stats: RepoStats;
}

export const GITHUB_REPO_OWNER = 'n30nex';
export const GITHUB_REPO_NAME = 'MC-CartoLive';
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
export const GITHUB_REPO_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
export const GITHUB_STATS_CACHE_KEY = 'mc-cartolive-github-stats';
export const GITHUB_STATS_CACHE_TTL_MS = 30 * 60_000;

const SHORT_SHA_LENGTH = 7;
const COMPACT_UTC_BUILD_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const ISO_LIKE_BUILD_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z| UTC|[+-]\d{2}:?\d{2})?$/;

export function releaseURLForVersion(version: string, baseURL = GITHUB_REPO_URL): string {
  return `${baseURL}/releases/tag/v${version}`;
}

export function commitURLForSha(sha: string, baseURL = GITHUB_REPO_URL): string {
  const normalized = normalizeGitSha(sha);
  return normalized ? `${baseURL}/commit/${normalized}` : baseURL;
}

export function shortBuildID(buildNumber: string, gitSha: string): string {
  const normalized = normalizeGitSha(gitSha);
  if (normalized) return normalized.slice(0, SHORT_SHA_LENGTH);
  return buildNumber.trim() || 'local';
}

export function normalizeGitSha(value: string | null | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^[0-9a-f]{7,40}$/i.test(normalized) ? normalized : '';
}

export function formatBuildAge(buildTimeISO: string, now = Date.now()): string {
  const builtAt = parseBuildTime(buildTimeISO);
  if (!Number.isFinite(builtAt)) return 'build age unavailable';
  const deltaMs = Math.max(0, now - builtAt);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'built just now';
  if (minutes < 60) return `built ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `built ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `built ${days}d ago`;
  const months = Math.floor(days / 30);
  return `built ${months}mo ago`;
}

export function parseBuildTime(value: string | null | undefined): number {
  const trimmed = value?.trim() ?? '';
  const compact = COMPACT_UTC_BUILD_TIME_RE.exec(trimmed);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return parseBuildTimeParts(year, month, day, hour, minute, second, undefined, 'Z');
  }
  const isoLike = ISO_LIKE_BUILD_TIME_RE.exec(trimmed);
  if (isoLike) {
    const [, year, month, day, hour, minute, second = '0', fraction, zone = 'Z'] = isoLike;
    return parseBuildTimeParts(year, month, day, hour, minute, second, fraction, zone);
  }
  return Number.NaN;
}

function parseBuildTimeParts(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
  fraction: string | undefined,
  zone: string
): number {
  const ms = fraction ? Number(fraction.slice(1, 4).padEnd(3, '0')) : 0;
  const values = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    ms
  };
  const localUTC = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second, values.ms);
  const localDate = new Date(localUTC);
  if (
    !Number.isFinite(localUTC) ||
    localDate.getUTCFullYear() !== values.year ||
    localDate.getUTCMonth() !== values.month - 1 ||
    localDate.getUTCDate() !== values.day ||
    localDate.getUTCHours() !== values.hour ||
    localDate.getUTCMinutes() !== values.minute ||
    localDate.getUTCSeconds() !== values.second
  ) {
    return Number.NaN;
  }
  const offsetMinutes = parseBuildZoneOffsetMinutes(zone);
  if (!Number.isFinite(offsetMinutes)) return Number.NaN;
  return localUTC - offsetMinutes * 60_000;
}

function parseBuildZoneOffsetMinutes(zone: string): number {
  if (zone === 'Z' || zone === ' UTC' || zone === '') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!match) return Number.NaN;
  const [, sign, hours, minutes] = match;
  const offsetHours = Number(hours);
  const offsetMinutes = Number(minutes);
  if (offsetHours > 23 || offsetMinutes > 59) return Number.NaN;
  const total = offsetHours * 60 + offsetMinutes;
  return sign === '+' ? total : -total;
}

export function normalizeRepoStats(payload: unknown): RepoStats | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybe = payload as { stargazers_count?: unknown; forks_count?: unknown };
  const stars = typeof maybe.stargazers_count === 'number' ? maybe.stargazers_count : null;
  const forks = typeof maybe.forks_count === 'number' ? maybe.forks_count : null;
  if (stars === null || forks === null) return null;
  return { stars: Math.max(0, Math.floor(stars)), forks: Math.max(0, Math.floor(forks)) };
}

export function readCachedRepoStats(storage: Storage | undefined, now = Date.now(), ttlMs = GITHUB_STATS_CACHE_TTL_MS): RepoStats | null {
  if (!storage) return null;
  try {
    const cached = JSON.parse(storage.getItem(GITHUB_STATS_CACHE_KEY) ?? 'null') as CachedRepoStats | null;
    if (!cached || now - cached.fetchedAt > ttlMs) return null;
    if (!Number.isFinite(cached.fetchedAt)) return null;
    if (!Number.isFinite(cached.stats.stars) || !Number.isFinite(cached.stats.forks)) return null;
    return cached.stats;
  } catch {
    return null;
  }
}

export function writeCachedRepoStats(storage: Storage | undefined, stats: RepoStats, now = Date.now()): void {
  if (!storage) return;
  try {
    storage.setItem(GITHUB_STATS_CACHE_KEY, JSON.stringify({ fetchedAt: now, stats }));
  } catch {
    // Best-effort cache only.
  }
}
