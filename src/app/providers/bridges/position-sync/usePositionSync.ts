import { useContext } from "react";
import { PositionSyncContext } from "./context";

export const usePositionSync = () => {
  const context = useContext(PositionSyncContext);
  if (!context) {
    throw new Error("usePosition must be used within PositionProvider");
  }
  return context;
};
