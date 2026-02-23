export const TABS = [
  { key: "general", label: "環境", desc: "ai_root/vaultなど" },
  { key: "engine", label: "エンジン管理", desc: "解析プリセットを編集" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
