import { X } from 'lucide-react';

interface Props { onClose: () => void; }

const GUIDE_SECTIONS = [
  {
    title: 'Live Map',
    body: 'Packet comets and fading trails show current public RF activity. Routes stay off until you turn them on.'
  },
  {
    title: 'Map Controls',
    body: 'Use Map for modes and layers, Routes for route lines, and Packets to animate a retained sanitized path.'
  },
  {
    title: 'Panels',
    body: 'Packets, Chat, NetGraph, node lists, and propagation history use the same sanitized public data as the map.'
  }
];

const SHORTCUTS = [
  { key: 'Escape', action: 'Clear selection / close panel' },
  { key: 'Space', action: 'Pause / resume live feed' },
  { key: 'L', action: 'Toggle live follow camera' },
  { key: '?', action: 'Show this help' },
  { key: 'Alt+1-7', action: 'Snap panel to anchor position' },
];

export default function ShortcutHelp({ onClose }: Props) {
  return (
    <div className="shortcut-help-overlay" onClick={onClose}>
      <div className="shortcut-help" role="dialog" aria-label="Map help and keyboard shortcuts" onClick={e => e.stopPropagation()}>
        <header>
          <h3>Map Help</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="shortcut-guide-grid">
          {GUIDE_SECTIONS.map((section) => (
            <section key={section.title}>
              <strong>{section.title}</strong>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
        <h4>Keyboard Shortcuts</h4>
        <dl>
          {SHORTCUTS.map(s => (
            <div key={s.key}>
              <dt><kbd>{s.key}</kbd></dt>
              <dd>{s.action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
