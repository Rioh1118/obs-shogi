import { useContext } from "react";
import { BookContext, type BookContextType } from "./context";

export function useBook(): BookContextType {
  const context = useContext(BookContext);
  if (!context) {
    throw new Error("useBook must be used within BookProvider");
  }
  return context;
}
