import { createContext } from "react";
import type { MateSearchContextType } from "./types";

export const MateSearchContext = createContext<MateSearchContextType | null>(null);
