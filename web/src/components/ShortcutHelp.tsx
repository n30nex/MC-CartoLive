import { X } from 'lucide-react';

interface Props { onClose: () => void; }

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
      <div className="shortcut-help" role="dialog" aria-label="Keyboard shortcuts" onClick={e => e.stopPropagation()}>
        <header>
          <h3>Keyboard Shortcuts</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
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
