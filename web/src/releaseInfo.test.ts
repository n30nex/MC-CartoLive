import { describe, expect, it } from 'vitest';
import indexHTML from '../index.html?raw';
import {
  commitURLForSha,
  formatBuildAge,
  normalizeGitSha,
  parseBuildTime,
  releaseURLForVersion,
  shortBuildID
} from './releaseInfo';

describe('release metadata helpers', () => {
  it('ships the 3.2.2 browser title without stale release identity', () => {
    expect(indexHTML).toContain('<title>MC-CartoLive v3.2.2');
    expect(indexHTML).not.toContain('v3.2.1');
  });
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

  it('strictly parses top-bar build times without normalizing invalid dates', () => {
    expect(parseBuildTime('2026-06-01 08:52:22 UTC')).toBe(Date.parse('2026-06-01T08:52:22Z'));
    expect(parseBuildTime('2026-06-01T10:52:22+02:00')).toBe(Date.parse('2026-06-01T08:52:22Z'));
    expect(parseBuildTime('2026-06-01T08:52:22.123456789Z')).toBe(Date.parse('2026-06-01T08:52:22.123Z'));
    expect(parseBuildTime('2026-02-31T00:00:00Z')).toBeNaN();
    expect(parseBuildTime('2026-06-01T08:52:22+24:00')).toBeNaN();
  });
});
