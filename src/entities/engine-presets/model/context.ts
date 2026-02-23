import { createContext } from "react";
import type { EnginePresetsContextType } from "./types";

export const EnginePresetsContext =
  createContext<EnginePresetsContextType | null>(null);
