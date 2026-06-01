import { describe, expect, it } from 'vitest';
import {
  GITHUB_STATS_CACHE_KEY,
  commitURLForSha,
  formatBuildAge,
  normalizeGitSha,
  normalizeRepoStats,
  parseBuildTime,
  readCachedRepoStats,
  releaseURLForVersion,
  shortBuildID,
  writeCachedRepoStats
} from './releaseInfo';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('release metadata helpers', () => {
  it('builds release and commit links from version and git sha', () => {
    expect(releaseURLForVersion('2.1.0')).toBe('https://github.com/n30nex/MC-CartoLive/releases/tag/v2.1.0');
    expect(commitURLForSha('0dec7aecfb3e5c4eea96081472e623b9234d92dd')).toBe(
      'https://github.com/n30nex/MC-CartoLive/commit/0dec7aecfb3e5c4eea96081472e623b9234d92dd'
    );
    expect(commitURLForSha('local-build')).toBe('https://github.com/n30nex/MC-CartoLive');
    expect(normalizeGitSha('0dec7ae')).toBe('0dec7ae');
    expect(normalizeGitSha('not-a-sha')).toBe('');
    expect(shortBuildID('20260523', '0dec7aecfb3e5c4eea96081472e623b9234d92dd')).toBe('0dec7ae');
    expect(shortBuildID('20260523', '')).toBe('20260523');
  });

  it('formats build age with stable local labels', () => {
    const now = Date.parse('2026-05-23T12:00:00Z');
    expect(formatBuildAge('2026-05-23T11:59:50Z', now)).toBe('built just now');
    expect(formatBuildAge('2026-05-23T11:21:00Z', now)).toBe('built 39m ago');
    expect(formatBuildAge('2026-05-22T10:00:00Z', now)).toBe('built 26h ago');
    expect(formatBuildAge('2026-05-20T12:00:00Z', now)).toBe('built 3d ago');
    expect(formatBuildAge('invalid', now)).toBe('build age unavailable');
  });

  it('formats compact UTC build stamps from Docker metadata', () => {
    const now = Date.parse('2026-06-01T09:00:00Z');
    expect(parseBuildTime('20260601T085222Z')).toBe(Date.parse('2026-06-01T08:52:22Z'));
    expect(formatBuildAge('20260601T085222Z', now)).toBe('built 7m ago');
  });

  it('normalizes and caches GitHub stats without trusting invalid payloads', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const now = 10_000;

    expect(normalizeRepoStats({ stargazers_count: 2.9, forks_count: 0 })).toEqual({ stars: 2, forks: 0 });
    expect(normalizeRepoStats({ stargazers_count: '2', forks_count: 0 })).toBeNull();
    expect(readCachedRepoStats(storage, now)).toBeNull();

    writeCachedRepoStats(storage, { stars: 2, forks: 0 }, now);
    expect(storage.getItem(GITHUB_STATS_CACHE_KEY)).toContain('"stars":2');
    expect(readCachedRepoStats(storage, now + 1_000)).toEqual({ stars: 2, forks: 0 });
    expect(readCachedRepoStats(storage, now + 31 * 60_000)).toBeNull();
  });
});
