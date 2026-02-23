import { createContext } from "react";
import type { FileTreeContextType } from "./types";

export const FileTreeContext = createContext<FileTreeContextType | undefined>(
  undefined,
);
