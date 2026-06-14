import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadingBlock, LoadingButtonLabel, LoadingRows, LoadingSpinner } from './LoadingPrimitives';
import PanelSkeleton from './PanelSkeleton';

describe('LoadingPrimitives', () => {
  it('renders an accessible branded spinner with a stable size class', () => {
    const html = renderToStaticMarkup(<LoadingSpinner size="lg" branded label="Loading live map" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading live map"');
    expect(html).toContain('loading-spinner-lg');
    expect(html).toContain('branded');
    expect(html).toContain('<img');
  });

  it('renders decorative spinners without duplicate status announcements', () => {
    const html = renderToStaticMarkup(<LoadingSpinner size="sm" decorative />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
  });

  it('renders loading blocks and skeleton rows for workspace surfaces', () => {
    const html = renderToStaticMarkup(
      <LoadingBlock title="Loading nodes" message="Preparing the public node workspace." rows={3} />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('Loading nodes');
    expect(html).toContain('Preparing the public node workspace.');
    expect(html.match(/<span class="loading-row/g)).toHaveLength(3);
  });

  it('renders standalone rows and stable loading button labels', () => {
    const rows = renderToStaticMarkup(<LoadingRows count={2} compact />);
    const button = renderToStaticMarkup(<LoadingButtonLabel loading label="Load older" loadingLabel="Searching" />);

    expect(rows.match(/<span class="loading-row/g)).toHaveLength(2);
    expect(rows).toContain('compact');
    expect(button).toContain('loading-button-spinner');
    expect(button).toContain('Searching');
    expect(button).not.toContain('Load older');
  });

  it('keeps PanelSkeleton contextual while using shared loading markup', () => {
    const html = renderToStaticMarkup(<PanelSkeleton title="Loading help" message="Opening map shortcuts." rows={2} />);

    expect(html).toContain('panel-skeleton');
    expect(html).toContain('Loading help');
    expect(html).toContain('Opening map shortcuts.');
    expect(html.match(/<span class="loading-row/g)).toHaveLength(2);
  });
});
