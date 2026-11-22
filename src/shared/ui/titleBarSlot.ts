import { createContext } from "react";

/** タイトルバーの中の、画面が見出しを描く所。タイトルバーが無ければ `null` */
export const TitleBarSlotContext = createContext<HTMLElement | null>(null);
