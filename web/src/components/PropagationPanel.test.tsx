import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PropagationPanel from './PropagationPanel';

describe('PropagationPanel', () => {
  it('renders a shared loading block while public propagation history loads', () => {
    const html = renderToStaticMarkup(
      <PropagationPanel
        conditions={null}
        events={[]}
        loading
        error={null}
        onClose={() => undefined}
        onFocus={() => undefined}
        onReplay={() => undefined}
      />
    );

    expect(html).toContain('Loading propagation history');
    expect(html).toContain('Checking public long-distance route context.');
    expect(html).toContain('loading-spinner');
    expect(html).not.toContain('raw path');
    expect(html).not.toContain('resolver');
  });
});
