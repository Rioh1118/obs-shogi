import { createContext } from "react";
import type { PositionSyncContextType } from "./types";

export const PositionSyncContext =
  createContext<PositionSyncContextType | null>(null);
