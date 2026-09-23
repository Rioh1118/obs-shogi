import { JKFPlayer, Normalizer } from "json-kifu-format";
import type { IMoveMoveFormat, IMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Piece } from "shogi.js";
import type { ForkPointer } from "../model/cursor";
import { eqMove } from "./eqMove";
import { resolveLine } from "./resolveLine";

export type ApplyMoveResult = {
  /** 既存の手（本譜 or 既存分岐）を使ったか */
  usedExisting: boolean;
  /** 棋譜に新しい分岐を1本足したか */
  createdNew: boolean;
  /** 適用後の手数 */
  tesuu: number;

  /** 現在ルートの分岐選択の履歴 */
  forkPointers: ForkPointer[];
};

/**
 * 現在の局面に move を適用する。
 * 1. 同じ手が本譜にあれば forward()
 * 2. 同じ手が forks[1..] にあれば forkAndForward()
 * 3. 無ければ新規分岐（次手が無ければ線の末尾）として追加
 *
 * 渡した `move` は棋譜が所有する。コピーせずそのまま収まり、正規化が
 * `color` / `piece` / `same` / `capture` / `promote` / `relative` を書き加える。
 * 呼び出し側は同じオブジェクトを使い回さないこと。
 *
 * **正規化するのは足した1手だけ。** 棋譜の他の手には触らない。
 *
 * @throws {Error} 終局の手（投了など）の後に足そうとしたとき、`move.to` が無いとき、
 *   盤上で指せない手のとき。いずれも棋譜を書き換える前に投げる
 */
export function applyMoveWithBranch(player: JKFPlayer, move: IMoveMoveFormat): ApplyMoveResult {
  const curTesuu = player.tesuu;

  // 1) 本線合流
  const nextFormat = getNextMoveFormat(player, curTesuu);
  if (nextFormat?.move && eqMove(nextFormat.move, move)) {
    player.forward();
    return buildResult(player, true, false);
  }

  // 2) 既存変化合流
  if (nextFormat?.forks) {
    for (let i = 0; i < nextFormat.forks.length; i++) {
      const forkLine = nextFormat.forks[i];
      const forkFirst = forkLine?.[0];
      if (forkFirst?.move && eqMove(forkFirst.move, move)) {
        player.forkAndForward(i);
        return buildResult(player, true, false);
      }
    }
  }

  // 3) 新規追加
  //
  // `player.inputMove()` も `Normalizer.normalizeMinimal(player.kifu)` も使わない。
  // どちらも足した後に**棋譜全体**を正規化し、どこか1手でも盤上で指せない手があると
  // そこで throw する。1箇所の壊れた変化のせいで、無関係な局面にも1手も足せなくなる。
  // `inputMove` はさらに `JKFPlayer.sameMoveMinimal` で合流を判定し、「3九金(49)」と
  // 「3九金打」を同一視する（issue #74）。合流の判定は上の 1)/2) の `eqMove` で済んでいる。
  const current = player.currentStream[curTesuu];
  if (current?.special) {
    throw new Error("終局した局面の後には指せません");
  }
  normalizeNewMove(player, current?.move, move);

  if (nextFormat) {
    if (!nextFormat.forks) {
      nextFormat.forks = [];
    }
    const newForkIndex = nextFormat.forks.length;
    nextFormat.forks.push([{ move }]);
    player.forkAndForward(newForkIndex);
    return buildResult(player, false, true);
  }

  // 末端（次手が存在しない）: 今いる線の末尾に足す
  appendToCurrentLine(player, { move });
  player.forward();
  return buildResult(player, false, true);
}

/**
 * 現局面で指す `move` に、`Normalizer.normalizeMinimal` が1手ぶんに書き足す情報を埋める
 *
 * 相対表記（`relative`）を埋めないと、分岐一覧で「3九金(49)」と「3九金打」が
 * 同じ文字列になり読み分けられない。
 *
 * 盤上で指せるかをここで試し、指せなければ棋譜に触る前に投げる。
 */
function normalizeNewMove(
  player: JKFPlayer,
  prev: IMoveMoveFormat | undefined,
  move: IMoveMoveFormat,
): void {
  // JKF で `to` が無いのは終局などの特殊な手だけで、盤から入る手には必ずある
  const to = move.to;
  if (!to) {
    throw new Error("移動先の無い手は棋譜に足せません");
  }
  const shogi = player.shogi;
  move.color = shogi.turn;
  if (move.from) {
    if (prev?.to && prev.to.x === to.x && prev.to.y === to.y) {
      move.same = true;
    }
    const captured = shogi.get(to.x, to.y);
    if (captured) {
      move.capture = captured.kind;
    }
    if (!move.piece) {
      move.piece = shogi.get(move.from.x, move.from.y).kind;
    }
    if (
      !move.promote &&
      !Piece.isPromoted(move.piece) &&
      Piece.canPromote(move.piece) &&
      (Normalizer.canPromote(to, shogi.turn) || Normalizer.canPromote(move.from, shogi.turn))
    ) {
      move.promote = false;
    }
    Normalizer.addRelativeInformation(shogi, move);
  } else if (shogi.getMovesTo(to.x, to.y, move.piece).length > 0) {
    move.relative = "H";
  }

  JKFPlayer.doMove(shogi, move);
  JKFPlayer.undoMove(shogi, move);
}

/**
 * 今いる線（本譜か、降りている変化）の末尾に1手足し、`player` から見えるようにする
 *
 * `player.currentStream` は線を繋いだ**写し**で、棋譜の配列を足しても伸びない。
 * `JKFPlayer` が写しを作り直す口（`updateForksAndCurrentStream`）は非公開なので、
 * 写しの側にも同じ手を足す。
 */
function appendToCurrentLine(player: JKFPlayer, entry: IMoveFormat): void {
  const stream = player.currentStream;
  const lengthBefore = stream.length;
  const { line } = resolveLine(player.kifu, player.getForkPointers(), player.tesuu + 1);
  line.push(entry);
  if (stream.length === lengthBefore) {
    stream.push(entry);
  }
}

function buildResult(
  player: JKFPlayer,
  usedExisting: boolean,
  createdNew: boolean,
): ApplyMoveResult {
  const fps = (player.getForkPointers?.() ?? []) as ForkPointer[];
  return {
    usedExisting,
    createdNew,
    tesuu: player.tesuu,
    forkPointers: fps,
  };
}

/**
 * 現在の手順での次の手 (moveFormat) を取得
 */
function getNextMoveFormat(player: JKFPlayer, tesuu: number): IMoveFormat | undefined {
  const currentStream = player.currentStream;

  if (!currentStream || tesuu + 1 >= currentStream.length) {
    return undefined;
  }

  return currentStream[tesuu + 1];
}
