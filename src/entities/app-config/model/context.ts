import { createContext } from "react";
import type { AppConfigContextType } from "./types";

export const AppConfigContext = createContext<AppConfigContextType | undefined>(
  undefined,
);
