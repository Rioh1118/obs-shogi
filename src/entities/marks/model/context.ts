import { createContext } from "react";
import type { MarksContextType } from "./types";

export const MarksContext = createContext<MarksContextType | null>(null);
