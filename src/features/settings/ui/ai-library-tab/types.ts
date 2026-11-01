import type { FsError } from "@/entities/file-tree";

/*
 * 手順書の型を置く。`SetupGuide.tsx` に置くと `steps/` の部品が親を読み、循環になる。
 * 読み手がこのディレクトリで閉じるので `entities/` へは下げない。
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
 * AI フォルダの作成の結果
 *
 * - `FsError`: 名前を直せば通る。欄のそばに出し、打った文字列は残す
 * - `"stale"`: 作り終える前に AI ルートが変わった。成功に畳むと打った名前が消え、`FsError` に畳むと
 *   名前が悪くないのに欄が赤くなる。旧ルートの結果は `staleCreateNotice` の通知が伝える
 * - `null`: 作れた。または名前で直せない失敗を診断へ回した
 */
export type CreateAiFolderResult = FsError | "stale" | null;
