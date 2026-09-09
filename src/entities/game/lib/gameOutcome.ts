/**
 * 1手ごとの終局判定。
 *
 * **`moveDecided` を受けた側が呼ぶ。** `null` が返ったときだけ `continueGame` を
 * 返してよい。どちらも返さないと Rust は裁定待ちのまま止まり、`RULING_TIMEOUT` で
 * 中断される（`entities/game-session/api/tauri.ts`）。
 *
 * **利用者に見せる文言はここで決めない。** 返すのは種別と勝者だけで、
 * `endGameByRule` に渡す `detail` の綴りは呼び出し側が決める。理由は
 * `KifuLoadFailure`（`entities/game/model/types.ts`）と同じ——ライブラリの英文や
 * 内部の語をそのまま外へ出すと、段と文言を決める場所が呼び出し側ごとに分かれる。
 *
 * **ルールの持ち主が2つに割れている。** 合法手の生成は shogi.js、千日手・
 * 連続王手・持将棋の点数は tsshogi。どちらか一方では賄えない——tsshogi は
 * 合法手を生成せず、shogi.js は千日手も点数も持たない。
 * shogi.js 側を選べないのは、盤の表示（移動可能マスの強調・成り選択）が既に
 * それを使っていて、重ねると合法手判定が2実装になるため
 * （`docs/state-transitions/game-session.md` の「責任の切れ目」）。
 */
import { Color, Shogi } from "shogi.js";
import { Position, Record as ShogiRecord } from "tsshogi";

import { Err, Ok, type Result } from "@/shared/lib/result";
import type { GameRules } from "./gameRules";
import { hasLegalMove } from "./moveValidation";
import { fromTsColor, opponentOf } from "./ruleColor";

/**
 * 終局の種別。**投了・時間切れ・中断は入らない**——それらは Rust が決めるので
 * 裁定として返す機会が無い（`GameOverReason`）。
 */
export type GameOutcomeKind =
  /** 詰み。手番側に合法手が無く、王手がかかっている */
  | "checkmate"
  /**
   * 手詰まり。手番側に合法手が無く、王手はかかっていない。
   *
   * **詰みと分けてあるのは棋譜に落とす綴りが違うため**（`TSUMI` に寄せられない）。
   * 勝敗の付き方は詰みと同じで、指せなくなった側が負け
   */
  | "stalemate"
  /** 千日手。同一局面が4回現れた */
  | "repetitionDraw"
  /** 連続王手の千日手。王手を続けた側の反則負け */
  | "perpetualCheck"
  /** トライルール。玉が相手玉の初期位置に着いた */
  | "tryRule"
  /** 最大手数（`GameRules.maxMoves`）に達した */
  | "maxMoves";

export interface GameOutcome {
  kind: GameOutcomeKind;
  /** 引き分けなら null */
  winner: Color | null;
}

/**
 * 局面を組み立てられなかった。**「まだ終わっていない」と混ぜないこと。**
 *
 * これが返ったら盤と Rust の指し手列が食い違っている。`continueGame` を返すと
 * Rust 側の検算で弾かれるので、対局を中断して利用者に見せるほかない。
 */
export type GameOutcomeFailure =
  | { code: "unplayable_start_sfen"; startSfen: string }
  | { code: "unplayable_move"; usiMove: string; ply: number };

export interface GameProgress {
  /**
   * 対局の根の局面。`GameSettings.startSfen` と同じもの。
   * **`startpos` は受け付けない**（あちらと同じ制約）
   */
  startSfen: string;
  /**
   * 根から現在までの USI 指し手。**`continueGame` に渡す列と同じもの。**
   * 途中局面から始めた対局なら `GameSettings.initialMoves` も含む
   */
  usiMoves: readonly string[];
}

/**
 * トライルールの到達点は相手玉の初期位置。先手なら5一、後手なら5九。
 *
 * **着いた時点で成立する。** 玉がそこへ動けたなら王手はかかっていないので、
 * 「取られない」ことを別に確かめる必要はない
 */
function isOnTrySquare(shogi: Shogi, color: Color): boolean {
  const piece = shogi.get(5, color === Color.Black ? 1 : 9);
  return !!piece && piece.color === color && piece.kind === "OU";
}

function buildRecord(progress: GameProgress): Result<ShogiRecord, GameOutcomeFailure> {
  const position = Position.newBySFEN(progress.startSfen);
  if (!position) {
    return Err({ code: "unplayable_start_sfen", startSfen: progress.startSfen });
  }

  // **`Record.newByUSI` を使わない。** あちらは読めない指し手で黙って打ち切り、
  // 途中までの棋譜を `Ok` として返すので、短い局面を「現在局面」と誤って裁定する
  const record = new ShogiRecord(position);
  for (const [index, usiMove] of progress.usiMoves.entries()) {
    const move = record.position.createMoveByUSI(usiMove);
    if (!move || !record.append(move)) {
      return Err({ code: "unplayable_move", usiMove, ply: index + 1 });
    }
  }
  return Ok(record);
}

/**
 * 現在局面が終局かを判定する。終わっていなければ `null`。
 *
 * **判定の順は勝敗が付くものが先。** 詰んだ局面は、それが同時に4回目の同一局面でも
 * 千日手にしないし、最大手数に達していても引き分けにしない。
 */
export function judgeGameOutcome(
  progress: GameProgress,
  rules: GameRules,
): Result<GameOutcome | null, GameOutcomeFailure> {
  const built = buildRecord(progress);
  if (!built.success) return built;
  const record = built.data;

  const shogi = new Shogi();
  shogi.initializeFromSFENString(record.position.sfen);
  const toMove = shogi.turn;
  const lastMover = opponentOf(toMove);

  if (!hasLegalMove(shogi, toMove)) {
    return Ok({
      kind: shogi.isCheck(toMove) ? "checkmate" : "stalemate",
      winner: lastMover,
    });
  }

  if (rules.jishogiRule === "try" && isOnTrySquare(shogi, lastMover)) {
    return Ok({ kind: "tryRule", winner: lastMover });
  }

  if (record.repetition) {
    // **返るのは王手を続けた側**、つまり反則負けになる側。
    // 双方が王手を続けていた形では tsshogi は先手だけを返す（あちらの決め方であって、
    // どちらを負けにすべきかを規則が定めているわけではない）
    const checking = record.perpetualCheck;
    return Ok(
      checking === null
        ? { kind: "repetitionDraw", winner: null }
        : { kind: "perpetualCheck", winner: opponentOf(fromTsColor(checking)) },
    );
  }

  if (rules.maxMoves > 0 && progress.usiMoves.length >= rules.maxMoves) {
    return Ok({ kind: "maxMoves", winner: null });
  }

  return Ok(null);
}
