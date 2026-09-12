// `UpdaterContextType` と `UpdaterState` はスライスの中だけで使う。
// **公開すると、どの feature でもこの形を組み立てられる**ように読めるが、
// 記憶を書ける口は `useUpdater()` が返す操作だけ
export type { ManualCheckResult, UpdaterFailure, UpdaterStatus } from "./model/types";
export { UpdaterProvider } from "./model/provider";
export { useUpdater } from "./model/useUpdater";

// **api を直に出さない。** 記憶を書ける口が2つあると、飛ばす版と
// 最後に確認できた時刻が別々に書かれて片方が潰れる。読み書きは
// `useUpdater()` が返す操作を通す
