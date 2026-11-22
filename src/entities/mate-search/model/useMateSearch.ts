import { useContext } from "react";
import { MateSearchContext } from "./context";
import type { MateSearchContextType } from "./types";

export function useMateSearch(): MateSearchContextType {
  const ctx = useContext(MateSearchContext);
  if (!ctx) throw new Error("useMateSearch must be used within MateSearchProvider");
  return ctx;
}
