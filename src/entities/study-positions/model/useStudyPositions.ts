import { useContext } from "react";
import { StudyPositionsContext } from "./context";
import type { StudyPositionsContextType } from "./context";

export function useStudyPositions(): StudyPositionsContextType {
  const ctx = useContext(StudyPositionsContext);
  if (!ctx) {
    throw new Error(
      "useStudyPositions must be used within StudyPositionsProvider",
    );
  }
  return ctx;
}
