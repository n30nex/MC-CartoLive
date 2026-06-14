import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, XCircle } from 'lucide-react';

export type ToastTone = 'info' | 'success' | 'warning' | 'error' | 'loading';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  durationMs?: number;
}

export interface ToastItem extends Required<Pick<ToastInput, 'tone' | 'title'>> {
  id: number;
  message?: string;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (toast: ToastInput) => number;
  dismissToast: (id: number) => void;
}

const DEFAULT_TOAST_DURATION_MS = 2600;
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIDRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = nextIDRef.current;
    nextIDRef.current += 1;
    const item: ToastItem = {
      id,
      tone: toast.tone ?? 'info',
      title: toast.title,
      message: toast.message
    };
    setToasts((current) => [item, ...current.filter((existing) => existing.title !== item.title).slice(0, 3)]);
    if (item.tone !== 'loading') {
      const duration = Math.max(800, toast.durationMs ?? DEFAULT_TOAST_DURATION_MS);
      const timer = window.setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismissToast]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const value = useMemo(() => ({ toasts, showToast, dismissToast }), [dismissToast, showToast, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToasts must be used inside ToastProvider');
  return value;
}

function ToastViewport() {
  const { toasts, dismissToast } = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <article key={toast.id} className={`app-toast toast-${toast.tone}`}>
          <span className="app-toast-icon" aria-hidden="true">{toastIcon(toast.tone)}</span>
          <span className="app-toast-copy">
            <strong>{toast.title}</strong>
            {toast.message && <small>{toast.message}</small>}
          </span>
          <button type="button" aria-label={`Dismiss ${toast.title}`} onClick={() => dismissToast(toast.id)}>
            <XCircle size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}

function toastIcon(tone: ToastTone) {
  if (tone === 'success') return <CheckCircle2 size={17} />;
  if (tone === 'warning') return <AlertTriangle size={17} />;
  if (tone === 'error') return <XCircle size={17} />;
  if (tone === 'loading') return <LoaderCircle size={17} className="toast-spinner" />;
  return <Info size={17} />;
}
