import type { FsError } from "@/entities/file-tree";

/*
 * **手順書の型はここに置く。** `SetupGuide.tsx`（親）に置くと、`steps/` の部品が
 * 親から型を読むことになり、辺が上向きに閉じる（`import type` だけの循環は
 * `import/no-cycle` が拾わないので、機械は何も言わない）。値を1つ共有したくなった日に
 * 実行時の循環へ変わり、評価の順によっては未初期化のまま読まれる。
 *
 * `EnginesDir` のように `entities/` へ下げないのは、読み手がこのディレクトリの中で
 * 閉じているから。下げると、この画面の都合の型が下の層に溜まる。
 */

export type SetupGuideProfile = {
  name: string;
  path: string;
  hasEvalDir: boolean;
  hasBookDir: boolean;
  evalCount: number;
  bookCount: number;
};

/**
 * AI フォルダを作りに行った答え。**3つに割る。**
 *
 * - `FsError` … 名前を直せば通る。欄のそばに出し、**打った文字列は残す**
 * - `"stale"` … **宛先を失った**。作り終える前に AI ルートが変わったか、そもそも宛先が無い
 *   （呼び出し元が空の名前を弾き、ルートが無ければフォームごと描かれないので、
 *   後者には到達しない想定）。**成功として扱わない**——畳んで `null` にすると
 *   打った名前が消え、打ち直したのかどうかも分からなくなる。`FsError` に畳むのも嘘で、
 *   名前は悪くないのに欄が赤くなる。
 *   **旧ルートで何が起きたかは通知が伝える**（`AiLibraryTab` の `staleCreateNotice`）
 * - `null` … 作れた。または名前では直せない失敗として診断側へ回した
 */
export type CreateAiFolderResult = FsError | "stale" | null;
