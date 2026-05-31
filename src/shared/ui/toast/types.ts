export type ToastLevel = "info" | "success" | "warn" | "error";

export interface ToastItem {
  id: string;
  level: ToastLevel;
  message: string;
  durationMs: number;
  createdAt: number;
}

export interface ToastApi {
  info: (message: string, durationMs?: number) => string;
  success: (message: string, durationMs?: number) => string;
  warn: (message: string, durationMs?: number) => string;
  error: (message: string, durationMs?: number) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}
