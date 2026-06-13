import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LinkBar, { LATEST_RELEASE_HIGHLIGHTS, WORKSPACE_LINKS } from './LinkBar';
import { LAB_EXPERIMENTS } from '../lab';

describe('LinkBar', () => {
  it('renders compact workspace and about controls', () => {
    const html = renderToStaticMarkup(<LinkBar netGraphOpen nodeListOpen />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('Workspaces');
    expect(html).toContain('About');
    expect(html).not.toContain('Open first-run setup');
    expect(html).not.toContain('#/setup');
    expect(html).not.toContain('#/perf');
    expect(html).not.toContain('Perf');
    expect(html).not.toContain('Features');
    expect(html).not.toContain('Guide');
    expect(html).toContain('class="link-bar-page active"');
    expect(html).toContain('Open MC-CartoLive');
    expect(html).not.toContain('Changelog');
  });

  it('marks Labs through the workspace menu trigger', () => {
    const html = renderToStaticMarkup(<LinkBar labOpen activeLabExperimentID="radar" />);
    expect(html).toContain('class="link-bar-page active"');
  });

  it('keeps the compact changelog focused on the current release train', () => {
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.label)).toEqual(['2.9.5', '2.9.4', '2.9.3']);
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.title)).toContain('Map Studio');
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.title)).toContain('Labs Polish');
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.title)).toContain('Live RF Labs');
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.body).join(' ')).not.toContain('Perf/Guide/Features');
  });

  it('defines the operator-simple workspace menu entries', () => {
    expect(WORKSPACE_LINKS.map((item) => item.label)).toEqual(['Packets', 'Nodes', 'Chat', 'NetGraph', 'Labs']);
    expect(WORKSPACE_LINKS.map((item) => item.href)).toEqual(['#/packets', '#/nodes', '#/chat', '#/netgraph', '#/lab']);
  });

  it('defines a public route for every Labs experiment', () => {
    for (const experiment of LAB_EXPERIMENTS) {
      expect(experiment.path).toBe(`#/lab/${experiment.id}`);
      expect(experiment.tagline.length).toBeGreaterThan(8);
    }
  });
});
