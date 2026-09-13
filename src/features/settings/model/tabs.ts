import type { TabType } from "@/shared/lib/router/useURLParams";

export const TABS = [
  {
    key: "workspace",
    label: "ワークスペース",
    desc: "保存場所・状態・メンテナンス",
  },
  {
    key: "aiLibrary",
    label: "AIライブラリ",
    desc: "engines/evel/bookの置き場所とルール",
  },
  { key: "engine", label: "エンジン管理", desc: "解析プリセットを編集" },
  // **綴りは URL の語彙**（`TabType`）に合わせる。合わせないと、ここを増やしても
  // 開く側が渡せる綴りが増えず、渡した先で既定のタブに落ちる
] as const satisfies readonly { key: TabType; label: string; desc: string }[];

export type TabKey = (typeof TABS)[number]["key"];
