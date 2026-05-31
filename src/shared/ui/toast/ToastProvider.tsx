import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ToastApi, ToastItem, ToastLevel } from "./types";
import "./Toast.scss";

const DEFAULT_DURATION_MS: Record<ToastLevel, number> = {
  info: 3000,
  success: 3000,
  warn: 5000,
  error: 7000,
};

const MAX_VISIBLE = 5;

export const ToastContext = createContext<ToastApi | null>(null);

function nextId() {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const push = useCallback(
    (level: ToastLevel, message: string, durationMs?: number): string => {
      const id = nextId();
      const dur = durationMs ?? DEFAULT_DURATION_MS[level];
      const item: ToastItem = {
        id,
        level,
        message,
        durationMs: dur,
        createdAt: Date.now(),
      };
      setItems((prev) => {
        const next = [...prev, item];
        return next.length > MAX_VISIBLE ? next.slice(-MAX_VISIBLE) : next;
      });
      if (dur > 0) {
        const t = window.setTimeout(() => dismiss(id), dur);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      info: (m, d) => push("info", m, d),
      success: (m, d) => push("success", m, d),
      warn: (m, d) => push("warn", m, d),
      error: (m, d) => push("error", m, d),
      dismiss,
      clear: () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current.clear();
        setItems([]);
      },
    }),
    [push, dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => window.clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-container" role="region" aria-label="通知" aria-live="polite">
          {items.map((i) => (
            <div
              key={i.id}
              className={`toast toast--${i.level}`}
              role={i.level === "error" || i.level === "warn" ? "alert" : "status"}
            >
              <span className="toast__message">{i.message}</span>
              <button
                type="button"
                className="toast__close"
                aria-label="通知を閉じる"
                onClick={() => dismiss(i.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
