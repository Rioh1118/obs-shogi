import { useContext } from "react";
import { UpdaterContext } from "./context";
import type { UpdaterContextType } from "./types";

export function useUpdater(): UpdaterContextType {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdater must be used within UpdaterProvider");
  }
  return ctx;
}
