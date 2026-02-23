import { createContext } from "react";
import type { GameContextType } from "./types";

export const GameContext = createContext<GameContextType | null>(null);
