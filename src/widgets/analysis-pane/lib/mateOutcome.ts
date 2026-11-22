import type { MateOutcome } from "@/entities/mate-search";
import { everyAttackGivesCheck } from "@/shared/lib/shogi/checkSequence";
import { formatMoveSequence } from "@/shared/lib/shogi/moveText";

type OutcomeTexts = {
  [K in MateOutcome["kind"]]: string | ((outcome: Extract<MateOutcome, { kind: K }>) => string);
};

const withMoves = (head: string, sfen: string, moves: string[]): string =>
  [head, ...formatMoveSequence(sfen, moves).map((m) => m.move)].join(" ");

/**
 * 詰み探索の結論の1行。種類ごとに別の文にする（`docs/spec/features/mate-search.md` の「結論の文」）。
 * 型が全種類を書かせる。Rust の種類が届いていることは `mateConclusionWire.test.ts` が見る
 */
const textsFor = (sfen: string): OutcomeTexts => ({
  mate: ({ moves }) => withMoves(`${moves.length}手詰`, sfen, moves),
  winFound: ({ plies, moves }) =>
    moves.length === plies && everyAttackGivesCheck(sfen, moves)
      ? withMoves(`${plies}手詰`, sfen, moves)
      : withMoves(`${plies}手で勝ちを読み切りました（王手の連続とは限りません）。`, sfen, moves),
  noMate: "詰みはありません。",
  timeout: "時間内に詰みを見つけられませんでした。",
  cancelled: "詰み探索を中止しました。",
  notSupported:
    "このエンジンは詰み探索に対応していません。設定の「エンジン管理」で、詰将棋エンジンのプリセットを選択してください。",
  unreadable: "エンジンの答えを読めませんでした。",
  startFailed:
    "詰み探索のエンジンを起動できませんでした。設定の「エンジン管理」で、詰み探索に使うプリセットを確認してください。",
  engineExited: "詰み探索のエンジンが終了しました。もう一度押すと再起動します。",
  stopUnanswered: "詰み探索のエンジンが中止に応答しませんでした。もう一度押すと再起動します。",
  refused:
    "詰み探索を開始できませんでした。もう一度押してください。続くときはアプリを再起動してください。",
});

/** `sfen` は探索した局面。詰み手順の表記に使う */
export function mateOutcomeText(outcome: MateOutcome, sfen: string): string {
  const text = textsFor(sfen)[outcome.kind] as string | ((o: MateOutcome) => string);
  return typeof text === "string" ? text : text(outcome);
}
