import type { TabType } from "@/shared/lib/router/useURLParams";

/**
 * 設定のタブ。`key` は URL の語彙（`TabType`）に合わせる。
 *
 * 合わせないと、ここを増やしても開く側が渡せる綴りが増えず、渡した先で既定のタブに落ちる。
 */
export const TABS = [
  {
    key: "workspace",
    label: "ワークスペース",
  },
  {
    key: "aiLibrary",
    label: "AI ライブラリ",
  },
  { key: "engine", label: "エンジン管理" },
  { key: "display", label: "表示" },
] as const satisfies readonly { key: TabType; label: string }[];

export type TabKey = (typeof TABS)[number]["key"];
