import {
  createOutcomeJudge,
  type GameOutcome,
  type GameOutcomeFailure,
  type GameRules,
} from "@/entities/game";
import type { GameProgressView, GameRuling, RulingAdapter } from "@/entities/game-session";

/**
 * 1手ごとの裁定。**返るのは「続く」か「終局」のどちらかだけ。**
 *
 * 判定そのものは `entities/game`、進行は `entities/game-session` にあり、
 * **2つを束ねるのでここが置ける最下層**（`features/engine-position-sync` と同じ理由）。
 * `app/` に置くと誰も import できず、単体で踏むこともできない。
 *
 * **1つの対局につき1つ作ること。** 中の判定器が棋譜を持ち回るので、
 * 使い回すぶんには正しく動く（続きでない列が来たら組み直す）が、
 * 2つ作ると同じ対局の棋譜を2本組むことになる。
 *
 * 判定が落ちたときに「続く」を返さないのは、落ち方が**その局面に固定されている**ため
 * ——指し手列が組み立てられないなら次の手でも同じ結果になり、詰みも千日手も
 * 二度と立たない。対局は誰も終われないまま Rust の手数上限まで走る。
 * **終局として畳み、理由を棋譜と画面に残すほうが失うものが少ない。**
 */
export function createRulingAdapter(rules: GameRules): RulingAdapter {
  const judge = createOutcomeJudge();

  return {
    judge: (progress: GameProgressView): GameRuling => {
      const judged = judge.judge({ ...progress }, rules);
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

/**
 * 指し手列を組み立てられなかったときの説明。**何手目で詰まったかを残す。**
 *
 * **「中断」と書かない。** その語は利用者が中断を押したときのもの（ADR-0011 決定1）で、
 * これはアプリが局面を組めなかった回。**この経路は帯を立てない**
 * （判定は投げずに値で失敗を返すので `rulingFailure` が `null` のまま）ので、
 * 故障が起きたことを言えるのはこの文言だけになる。
 */
function unplayableDetail(failure: GameOutcomeFailure): string {
  return failure.code === "unplayable_start_sfen"
    ? "開始局面を読めないため終局にしました"
    : `${failure.ply}手目（${failure.usiMove}）を指せないため終局にしました`;
}
