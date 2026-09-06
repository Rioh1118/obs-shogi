import { useContext } from "react";
import { NotificationContext } from "./context";
import type { NotificationContextType } from "./types";

export function useNotifications(): NotificationContextType {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return ctx;
}
