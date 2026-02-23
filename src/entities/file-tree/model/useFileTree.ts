import { useContext } from "react";
import { FileTreeContext } from "./context";

export function useFileTree() {
  const ctx = useContext(FileTreeContext);
  if (!ctx) throw new Error("useFileTree must be used within FileTreeProvider");
  return ctx;
}
