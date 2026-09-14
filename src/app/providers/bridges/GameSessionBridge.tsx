import { useMemo, type ReactNode } from "react";
import {
  GameSessionProvider,
  type GameProgressView,
  type GameRuling,
  type RulingAdapter,
} from "@/entities/game-session";
import {
  DEFAULT_GAME_RULES,
  judgeGameOutcome,
  type GameOutcome,
  type GameOutcomeFailure,
  type GameRules,
} from "@/entities/game";

/**
 * 対局の進行に、終局の判定を繋ぐ。
 *
 * **判定を `entities/game-session` の中から呼ばない。** あちらは `Side` を
 * `entities/game` に渡している側なので、読み返すと互いを読み合う組ができて
 * `src/__tests__/crossSliceImports.test.ts` が落ちる。`AnalysisBridge` が
 * `PositionSyncAdapter` を渡しているのと同じ形で、ここから注入する。
 *
 * **ルール（持将棋の規則・最大手数）を持つのもここ。** `GameRules` は
 * `entities/game` の型なので、対局の進行に持たせると同じ辺ができる。
 * 利用者が選べるようにする口はまだ無いので、いまは既定値を使う。
 */
export function GameSessionBridge({ children }: { children: ReactNode }) {
  const ruling = useMemo(() => createRulingAdapter(DEFAULT_GAME_RULES), []);

  return <GameSessionProvider ruling={ruling}>{children}</GameSessionProvider>;
}

/**
 * 1手ごとの裁定。**返るのは「続く」か「終局」のどちらかだけ。**
 *
 * 判定が落ちたときに「続く」を返さないのは、落ち方が**その局面に固定されている**ため
 * ——指し手列が組み立てられないなら次の手でも同じ結果になり、詰みも千日手も
 * 二度と立たない。対局は誰も終われないまま Rust の手数上限まで走る。
 * **終局として畳み、理由を棋譜と画面に残すほうが失うものが少ない。**
 */
function createRulingAdapter(rules: GameRules): RulingAdapter {
  return {
    judge: (progress: GameProgressView): GameRuling => {
      const judged = judgeGameOutcome({ ...progress }, rules);
      if (!judged.success) {
        return { kind: "over", winner: null, detail: unplayableDetail(judged.error) };
      }
      return judged.data === null ? { kind: "continue" } : toRuling(judged.data);
    },
  };
}

/**
 * 終局の文言。**`judgeGameOutcome` は種別と勝者しか返さない**ので、
 * 棋譜と画面に残る綴りはここで決める（`entities/game` の doc）。
 */
function toRuling(outcome: GameOutcome): GameRuling {
  return { kind: "over", winner: outcome.winner, detail: OUTCOME_DETAIL[outcome.kind] };
}

/**
 * **`Record` にしてあるので、種別を1つ足して文言を書かないと tsc が落ちる。**
 * 既定の綴りを持たせると、新しい種別が「不明な理由」として棋譜に残る。
 */
const OUTCOME_DETAIL: Record<GameOutcome["kind"], string> = {
  checkmate: "詰み",
  // **詰みと分けて書く。** 勝敗の付き方は同じだが、棋譜に落とす綴りが違う
  stalemate: "手詰まり",
  repetitionDraw: "千日手",
  perpetualCheck: "連続王手の千日手",
  tryRule: "トライルール",
  maxMoves: "最大手数",
};

/** 指し手列を組み立てられなかったときの説明。**何手目で詰まったかを残す** */
function unplayableDetail(failure: GameOutcomeFailure): string {
  return failure.code === "unplayable_start_sfen"
    ? "開始局面を読めないため中断しました"
    : `${failure.ply}手目（${failure.usiMove}）を指せないため中断しました`;
}
