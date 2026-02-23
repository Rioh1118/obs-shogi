import { useContext } from "react";
import { AppConfigContext } from "./context";
import type { AppConfigContextType } from "./types";

export function useAppConfig(): AppConfigContextType {
  const ctx = useContext(AppConfigContext);
  if (!ctx) {
    throw new Error("useAppConfig must be used within AppConfigProvider");
  }
  return ctx;
}
