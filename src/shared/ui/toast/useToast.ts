import { useContext } from "react";
import { ToastContext } from "./ToastProvider";
import type { ToastApi } from "./types";

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
