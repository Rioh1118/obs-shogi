import { createContext } from "react";
import type { NotificationContextType } from "./types";

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined);
