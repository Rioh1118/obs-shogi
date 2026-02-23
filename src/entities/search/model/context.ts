import { createContext } from "react";
import type { PositionSearchContextType } from "./types";

export const PositionSearchContext =
  createContext<PositionSearchContextType | null>(null);
