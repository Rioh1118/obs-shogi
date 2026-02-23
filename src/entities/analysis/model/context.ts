import { createContext } from "react";
import type { AnalysisContextType } from "./types";

export const AnalysisContext = createContext<AnalysisContextType | null>(null);
