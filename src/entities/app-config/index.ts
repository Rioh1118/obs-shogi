export type { AppConfig, DisplayConfigPatch } from "./model/types";
export { AppConfigProvider } from "./model/provider";
export { useAppConfig } from "./model/useAppConfig";

// `api` を公開しない。feature から呼ぶと共有の `config` が更新されないまま画面だけが
// 新しい場所を見る（診断は OK なのに、エンジンプリセットの候補は空、という形で出る）。
// 失敗も誰にも受けられない。読み書きは `useAppConfig()` を通す
