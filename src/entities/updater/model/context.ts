import { createContext } from "react";
import type { UpdaterContextType } from "./types";

export const UpdaterContext = createContext<UpdaterContextType | undefined>(undefined);
