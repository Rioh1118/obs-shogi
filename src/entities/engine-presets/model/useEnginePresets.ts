import { useContext } from "react";
import { EnginePresetsContext } from "./context";

export function useEnginePresets() {
  const ctx = useContext(EnginePresetsContext);
  if (!ctx) throw new Error("useEnginePresets must be used within EnginePresetsProvider");
  return ctx;
}
