import { describe, expect, it, vi } from 'vitest';
import { filterDashboardActions, type DashboardAction } from './uiActions';

const actions: DashboardAction[] = [
  { id: 'packets', label: 'Packet history', description: 'Inspect routed packets', group: 'Explore', keywords: ['traffic'], run: vi.fn() },
  { id: 'nodes', label: 'Browse nodes', description: 'Open phonebook', group: 'Explore', run: vi.fn() },
  { id: 'disabled', label: 'Unavailable', description: 'No target', group: 'Playback', disabled: true, run: vi.fn() }
];

describe('dashboard action registry', () => {
  it('supports shared label, description, group, and keyword search', () => {
    expect(filterDashboardActions(actions, 'traffic').map((action) => action.id)).toEqual(['packets']);
    expect(filterDashboardActions(actions, 'explore phonebook').map((action) => action.id)).toEqual(['nodes']);
    expect(filterDashboardActions(actions, '').map((action) => action.id)).toEqual(['packets', 'nodes']);
  });
});
