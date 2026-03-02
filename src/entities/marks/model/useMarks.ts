import { useContext } from "react";
import { MarksContext } from "./context";

export function useMarks() {
  const ctx = useContext(MarksContext);
  if (!ctx) throw new Error("useMarks must be used within MarksProvider");
  return ctx;
}
