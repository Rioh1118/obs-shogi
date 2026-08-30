export type { AppConfig, ChooseOpts } from "./model/types";
export { AppConfigProvider } from "./model/provider";
export { useAppConfig } from "./model/useAppConfig";

export { loadConfig, saveConfig } from "./api/config";
// **api を直に出さない。** feature から呼ぶと共有の `config` が更新されないまま
// 画面だけが新しい場所を見る（診断は OK なのに、エンジンプリセットの候補は空、
// という形で出る）。失敗も誰にも掴まれない。呼ぶのは `useAppConfig()` 経由
