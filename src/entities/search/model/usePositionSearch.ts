import { useContext } from "react";
import { PositionSearchContext } from "./context";
import type { PositionSearchContextType } from "./types";

export function usePositionSearch(): PositionSearchContextType {
  const ctx = useContext(PositionSearchContext);
  if (!ctx) {
    throw new Error(
      "usePositionSearch must be used within PositionSearchProvider",
    );
  }
  return ctx;
}
