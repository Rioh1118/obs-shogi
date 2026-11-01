// `UpdaterContextType` と `UpdaterState` は公開しない。記憶を書ける経路は
// `useUpdater()` が返す操作だけで、公開すると feature がこの形を組み立てられるように読める
export type { ManualCheckResult, UpdaterFailure, UpdaterStatus } from "./model/types";
export { acceptsManualCheck } from "./lib/acceptsManualCheck";
export { UpdaterProvider } from "./model/provider";
export { useUpdater } from "./model/useUpdater";

// `api` を公開しない。記憶を書ける経路が2つあると、飛ばす版と最後に確認できた時刻が
// 別々に書かれて片方が潰れる
