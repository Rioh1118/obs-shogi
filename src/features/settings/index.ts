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
] as const;

export type TabKey = (typeof TABS)[number]["key"];
