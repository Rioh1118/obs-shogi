import type { VisibleTier } from "@/shared/lib/notification/types";
import type { NavigationOutcome } from "../model/usePositionHitNavigation";

/**
 * ヒットを開けなかった理由
 *
 * tier はこの画面から直せるかで決める（ADR-0004 決定1）。
 *
 * - `danger`（別の操作が要る）は、索引がパスを返さないときと、ツリーにその棋譜が無いとき。
 *   どちらも次に索引が更新されるまでは同じ結果が返るので、検索し直しても直らない。
 *   Rust は1回の検索のあいだ同じスナップショットを使い、`mergeFiles` は同じ値なら書き換えない
 * - `warning` は、ツリーをまだ読めていないとき。読めれば同じ操作で開ける
 *
 * 2つの `danger` を1つの文言にまとめない。行き先のパスを引けないのは索引の側の
 * 欠けで、ツリーを見てもいない。同じ文で「ワークスペースを探した」と言うと、
 * 動かしていない棋譜を探しに行かせる。
 *
 * `describeFsError` / `fsErrorTier` は通さない。あちらは fs を叩いた結果の
 * `FsError` を訳す関数だが、この断りは fs を1回も叩いておらず、見ているのは
 * 索引とツリーの食い違いだけ。ツリーから開いたときの `not_found` は読み直せば直る
 * `warning` で、復帰の仕方が違う。
 */
export type RefusalReason = "no-path" | Exclude<NavigationOutcome, "started">;

export const REFUSALS: Record<RefusalReason, { tier: VisibleTier; title: string; body: string }> = {
  "no-path": {
    tier: "danger",
    title: "この棋譜の場所が分かりません",
    body: "検索の索引が、この結果の置き場を返していません。索引が更新されるまで、この結果からは開けません。",
  },
  "tree-unavailable": {
    tier: "warning",
    title: "ワークスペースの一覧をまだ読み込めていません",
    body: "一覧を読み込めたあと、もう一度お試しください。",
  },
  "not-in-tree": {
    tier: "danger",
    title: "この棋譜を開けません",
    body: "ワークスペースの一覧にこの棋譜がありません。移動・削除されたか、索引がまだ古い可能性があります。一覧から別のヒットを選択してください。",
  },
};
