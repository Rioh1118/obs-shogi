// src/services/branch/applyMoveWithBranch.ts
import { JKFPlayer } from "json-kifu-format";
import type {
  IMoveMoveFormat,
  IMoveFormat,
} from "json-kifu-format/dist/src/Formats";
import type { ForkPointer } from "@/types/branch";
import { eqMove } from "@/utils/eqMove";

export type ApplyMoveResult = {
  /** 既存の手（本譜 or 既存分岐）を使ったか */
  usedExisting: boolean;
  /** 新規分岐を作ったか（= inputMove したか） */
  createdNew: boolean;
  /** 適用後の tesuu（jkf.tesuu） */
  tesuu: number;
  /** 適用後の forkPointers（現在の経路） */
  forkPointers: ForkPointer[];
};

/**
 * 現在の局面に move を適用する。
 * 1. 同じ手が本譜にあれば forward()
 * 2. 同じ手が forks[1..] にあれば forkAndForward()
 * 3. 無ければ inputMove() で新規分岐を作成
 */
export function applyMoveWithBranch(
  jkf: JKFPlayer,
  move: IMoveMoveFormat,
): ApplyMoveResult {
  const curTesuu = jkf.tesuu;

  // 1. 本譜（currentStream）の “次の手” をチェック
  const mainNext = jkf.currentStream[curTesuu + 1];
  if (mainNext?.move && eqMove(mainNext.move, move)) {
    jkf.forward(); // 本譜に進む
    return done(jkf, { usedExisting: true, createdNew: false });
  }

  // 2. forks から当該手数の分岐一覧を取得
  const fork = jkf.forks.find((f) => f.te === curTesuu);
  if (fork) {
    // fork.moves[0] は本譜、1.. が分岐
    for (let i = 1; i < fork.moves.length; i++) {
      const cand: IMoveFormat = fork.moves[i];
      if (cand.move && eqMove(cand.move, move)) {
        // 分岐へ入って1手進む
        jkf.forkAndForward(i);
        return done(jkf, { usedExisting: true, createdNew: false });
      }
    }
  }

  // 3. なければ inputMove で分岐作成
  jkf.inputMove(move);
  return done(jkf, { usedExisting: false, createdNew: true });
}

function done(
  jkf: JKFPlayer,
  flags: Pick<ApplyMoveResult, "usedExisting" | "createdNew">,
): ApplyMoveResult {
  return {
    ...flags,
    tesuu: jkf.tesuu,
    forkPointers: jkf.getForkPointers(),
  };
}
