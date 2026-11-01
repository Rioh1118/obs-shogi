import type { AiRootIndex } from "@/entities/engine/api/aiLibrary";

/**
 * 読めた索引と、読んだルート
 *
 * ルートを持たせないと、別のルートを選んだ直後に前の索引が残り、「engines/ を開く」が前のフォルダを開く。
 */
type LoadedIndex = { root: string; index: AiRootIndex };

/**
 * AI ルートの読み取りの状態
 *
 * `loading` と `error` も最後に読めた索引を持つ。捨てると `classifyEnginesDir` が `unknown` を返し、
 * 帯や「開く」が消えて、作成済みのフォルダに何もできなくなる。ルートを読めなかったときだけ捨てる。
 */
export type ScanState =
  | { status: "idle" }
  | { status: "loading"; last: LoadedIndex | null }
  | { status: "ready"; loaded: LoadedIndex }
  | { status: "error"; error: string; last: LoadedIndex | null };

function lastLoaded(scan: ScanState): LoadedIndex | null {
  switch (scan.status) {
    case "ready":
      return scan.loaded;
    case "loading":
    case "error":
      return scan.last;
    case "idle":
      return null;
  }
}

/** `root` の索引。別のルートの索引は返さない。切り替えた直後はまだ何も読めていない */
export function indexOfRoot(scan: ScanState, root: string | null): AiRootIndex | null {
  const loaded = lastLoaded(scan);
  return loaded?.root === root ? loaded.index : null;
}

/** 読めた索引を残して読み取りを始める */
export function startLoading(scan: ScanState): ScanState {
  return { status: "loading", last: lastLoaded(scan) };
}

/** 失敗を積む更新。読めていた索引は残す */
export function failKeepingIndex(error: string) {
  return (scan: ScanState): ScanState => ({ status: "error", error, last: lastLoaded(scan) });
}
