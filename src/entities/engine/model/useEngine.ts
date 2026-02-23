import { useContext } from "react";
import { EngineContext } from "./context";
import type { EngineContextType } from "./types";

export function useEngine(): EngineContextType {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error("useEngine must be used within EngineProvider");
  return ctx;
}
