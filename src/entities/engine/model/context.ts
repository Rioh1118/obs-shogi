import { createContext } from "react";
import type { EngineContextType } from "./types";

export const EngineContext = createContext<EngineContextType | null>(null);
