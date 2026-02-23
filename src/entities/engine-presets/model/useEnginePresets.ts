import { useContext } from "react";
import { EnginePresetsContext } from "./context";

export function useEnginePresets() {
  const ctx = useContext(EnginePresetsContext);
  if (!ctx) throw new Error("usePresets must be used within PresetsProvider");
  return ctx;
}
