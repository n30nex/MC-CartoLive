import { describe, expect, it } from 'vitest';
import { toggleWorkspacePresentation, workspacePresentationTitle } from './workspacePanel';

describe('workspace panel helpers', () => {
  it('toggles between side dock and full-screen workspace modes', () => {
    expect(toggleWorkspacePresentation('side')).toBe('fullscreen');
    expect(toggleWorkspacePresentation('fullscreen')).toBe('side');
    expect(workspacePresentationTitle('side')).toBe('Expand to full screen');
    expect(workspacePresentationTitle('fullscreen')).toBe('Dock as side panel');
  });
});
