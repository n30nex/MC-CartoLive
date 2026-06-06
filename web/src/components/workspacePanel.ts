export type WorkspacePresentation = 'side' | 'fullscreen';

export function toggleWorkspacePresentation(value: WorkspacePresentation): WorkspacePresentation {
  return value === 'fullscreen' ? 'side' : 'fullscreen';
}

export function workspacePresentationTitle(value: WorkspacePresentation): string {
  return value === 'fullscreen' ? 'Dock as side panel' : 'Expand to full screen';
}
