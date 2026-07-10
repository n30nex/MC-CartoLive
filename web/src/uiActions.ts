export type DashboardActionGroup = 'Explore' | 'Playback' | 'View' | 'Utility';

export interface DashboardAction {
  id: string;
  label: string;
  description: string;
  group: DashboardActionGroup;
  keywords?: string[];
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export function filterDashboardActions(actions: readonly DashboardAction[], query: string): DashboardAction[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return actions.filter((action) => !action.disabled);
  return actions.filter((action) => {
    if (action.disabled) return false;
    const haystack = [action.label, action.description, action.group, ...(action.keywords ?? [])].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
