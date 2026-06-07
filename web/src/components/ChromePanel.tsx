import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import {
  anchorPosition,
  clampPanelPosition,
  nearestPanelAnchor,
  useViewportBounds,
  type ChromePanelAnchor,
  type ChromePanelID,
  type PanelSize,
  type Point
} from './panelChrome';

interface Props {
  panel: ChromePanelID;
  title: string;
  anchor: ChromePanelAnchor;
  hidden: boolean;
  className?: string;
  children: ReactNode;
  onAnchorChange: (panel: ChromePanelID, anchor: ChromePanelAnchor) => void;
  onHide: (panel: ChromePanelID) => void;
}

interface DragState {
  pointerId: number;
  offset: Point;
  panel: PanelSize;
}

export default function ChromePanel({ panel, title, anchor, hidden, className = '', children, onAnchorChange, onHide }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draftPosition, setDraftPosition] = useState<Point | null>(null);
  const [panelSize, setPanelSize] = useState<PanelSize>({ width: 0, height: 0 });
  const viewportBounds = useViewportBounds();

  const measurePanel = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    setPanelSize((current) => {
      const next = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      return current.width === next.width && current.height === next.height ? current : next;
    });
  }, []);

  useLayoutEffect(() => {
    if (hidden) return undefined;
    measurePanel();
    const onResize = () => {
      measurePanel();
    };
    window.addEventListener('resize', onResize);
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', onResize);
    }
    const observer = new ResizeObserver(measurePanel);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [hidden, measurePanel]);

  if (hidden) return null;

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      panel: { width: rect.width, height: rect.height }
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDraftPosition(clampPanelPosition({ x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y }, drag.panel, viewportBounds));
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const frame = frameRef.current;
    const rect = frame?.getBoundingClientRect();
    const panelSize = rect ? { width: rect.width, height: rect.height } : drag.panel;
    const center = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: event.clientX, y: event.clientY };
    onAnchorChange(panel, nearestPanelAnchor(center, panelSize, viewportBounds));
    dragRef.current = null;
    setDraftPosition(null);
  };

  const anchoredPosition = draftPosition ?? anchorPosition(anchor, panelSize, viewportBounds);
  const style = {
    left: anchoredPosition.x,
    top: anchoredPosition.y,
    right: 'auto',
    bottom: 'auto',
    visibility: panelSize.width === 0 && panelSize.height === 0 ? 'hidden' : undefined
  } as CSSProperties;

  return (
    <div ref={frameRef} className={`chrome-panel-frame panel-${panel} anchor-${anchor} ${draftPosition ? 'dragging' : ''} ${className}`} style={style}>
      <div className="chrome-panel-toolbar" onPointerDown={startDrag} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
        <GripHorizontal size={14} aria-hidden="true" />
        <span>{title}</span>
        <button type="button" aria-label={`Hide ${title}`} title={`Hide ${title}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onHide(panel)}>
          <X size={13} />
        </button>
      </div>
      {children}
    </div>
  );
}
