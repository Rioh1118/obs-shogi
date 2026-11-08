import {
  createOutcomeJudge,
  type GameOutcome,
  type GameOutcomeFailure,
  type GameRules,
} from "@/entities/game";
import type { GameProgressView, GameRuling, RulingAdapter } from "@/entities/game-session";

/**
 * 対局1つぶんの裁定器を作る。1手ごとの裁定は「続く」か「終局」のどちらかだけを返す。
 *
 * 判定そのものは `entities/game`、進行は `entities/game-session` にあり、
 * 2つを束ねるのでここが置ける最下層（`features/engine-position-sync` と同じ理由）。
 * `app/` に置くと誰も import できず、単体で踏むこともできない。
 *
 * 1つの対局につき1つ作ること。中の判定器が棋譜を持ち回るので、
 * 使い回すぶんには正しく動く（続きでない列が来たら組み直す）が、
 * 2つ作ると同じ対局の棋譜を2本組むことになる。
 *
 * 判定が落ちたときに「続く」を返さないのは、落ち方が**その局面に固定されている**ため。
 * 指し手列が組み立てられないなら次の手でも同じ結果になり、詰みも千日手も
 * 二度と立たない。続けると誰も終われないまま Rust の手数上限まで走るので、終局にする。
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
 * 判定の答えを終局の裁定へ写す。`createOutcomeJudge` の判定器は種別と勝者しか
 * 返さないので、終局の説明（`detail`）の綴りはここで決める。
 *
 * `detail` は Rust が終局の結果に載せて返すが、いまは画面にも棋譜にも読み手が無い。
 */
function toRuling(outcome: GameOutcome): GameRuling {
  return { kind: "over", winner: outcome.winner, detail: OUTCOME_DETAIL[outcome.kind] };
}

/**
 * 終局の種別ごとの説明。`Record` なので、種別を足して文言を書かないと tsc が落ちる。
 * 既定の綴りを持たせると、新しい種別が「不明な理由」として結果に載る。
 */
const OUTCOME_DETAIL: Record<GameOutcome["kind"], string> = {
  checkmate: "詰み",
  // 詰みと分けて書く。勝敗の付き方は同じだが、説明の綴りが違う
  stalemate: "手詰まり",
  repetitionDraw: "千日手",
  perpetualCheck: "連続王手の千日手",
  tryRule: "トライルール",
  maxMoves: "最大手数",
};

/**
 * 指し手列を組み立てられなかったときの説明を返す。何手目で詰まったかを残す。
 *
 * **「中断」と書かない。** その語は利用者が中断を押したときのもの（ADR-0011 決定1）で、
 * これはアプリが局面を組めなかったとき。この経路は帯を立てない
 * （判定は投げずに値で失敗を返すので `rulingFailure` が `null` のまま）ので、
 * 故障の記録はこの文言だけになる。
 */
function unplayableDetail(failure: GameOutcomeFailure): string {
  return failure.code === "unplayable_start_sfen"
    ? "開始局面を読めないため終局にしました"
    : `${failure.ply}手目（${failure.usiMove}）を指せないため終局にしました`;
}
