import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OBSERVER_NODE_VISUAL, NODE_ROLE_VISUALS } from '../nodeVisuals';
import Legend from './Legend';

describe('Legend', () => {
  it('renders the same public node roles that the map icon registry uses', () => {
    const html = renderToStaticMarkup(<Legend />);
    for (const visual of [...NODE_ROLE_VISUALS.slice(0, 3), OBSERVER_NODE_VISUAL, ...NODE_ROLE_VISUALS.slice(3)]) {
      expect(html).toContain(visual.label);
      expect(html).toContain(visual.icon);
    }
  });
});
