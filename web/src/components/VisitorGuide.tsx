import { Keyboard, Route, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

export const VISITOR_GUIDE_STORAGE_KEY = 'mc-cartolive-visitor-guide-dismissed-v300';

interface VisitorGuideProps {
  knownPathwaysOn: boolean;
  suppressed?: boolean;
  defaultOpen?: boolean;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onToggleKnownPathways: () => void;
}

export default function VisitorGuide({
  knownPathwaysOn,
  suppressed = false,
  defaultOpen,
  onOpenSettings,
  onOpenHelp,
  onToggleKnownPathways
}: VisitorGuideProps) {
  const [open, setOpen] = useState(() => defaultOpen ?? !readDismissed());

  if (!open || suppressed) return null;

  const dismiss = () => {
    setOpen(false);
    writeDismissed();
  };

  return (
    <section className="visitor-guide" role="region" aria-label="First visit map guide">
      <button type="button" className="visitor-guide-close" aria-label="Dismiss map guide" onClick={dismiss}>
        <X size={14} />
      </button>
      <span className="panel-eyebrow">Live map</span>
      <h2>Watch RF traffic move</h2>
      <p>Comets show current public traffic. Select a node or pathway for details, or open Packets to replay a sanitized routed path on the map.</p>
      <div className="visitor-guide-actions">
        <button type="button" onClick={onOpenSettings}>
          <SlidersHorizontal size={14} />
          <span>Map</span>
        </button>
        <button type="button" className={knownPathwaysOn ? 'active' : ''} aria-pressed={knownPathwaysOn} onClick={onToggleKnownPathways}>
          <Route size={14} />
          <span>{knownPathwaysOn ? 'Routes on' : 'Routes off'}</span>
        </button>
        <button type="button" onClick={onOpenHelp}>
          <Keyboard size={14} />
          <span>Help</span>
        </button>
      </div>
    </section>
  );
}

function readDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(VISITOR_GUIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(VISITOR_GUIDE_STORAGE_KEY, '1');
  } catch {
    // Local-only onboarding should never block the map.
  }
}
