import { describe, expect, it } from 'vitest';
import { OBSERVER_NODE_VISUAL, NODE_ROLE_VISUALS, nodeMapImageID, nodeRoleColor, nodeRoleVisual } from './nodeVisuals';

describe('node visuals', () => {
  it('uses one role registry for map images, legend icons, and role colors', () => {
    expect(NODE_ROLE_VISUALS.map((visual) => visual.label)).toEqual(['Repeater', 'Companion', 'Room', 'Sensor', 'Other']);
    expect(OBSERVER_NODE_VISUAL.label).toBe('Observer');

    for (const visual of NODE_ROLE_VISUALS) {
      expect(nodeMapImageID(visual.role)).toBe(visual.mapImageID);
      expect(nodeRoleColor(visual.role)).toBe(visual.color);
      expect(visual.icon).toBeTruthy();
    }
  });

  it('falls unknown roles back to the public Other visual', () => {
    expect(nodeRoleVisual('experimental').label).toBe('Other');
    expect(nodeMapImageID('experimental')).toBe('node-unknown');
  });
});
