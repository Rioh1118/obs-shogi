import {
  isValidJKFSpecial,
  type InitialPresetString,
  type JKFBranchPath,
  type JKFData,
  type JKFMove,
  type JKFSpecialType,
  type JKFState,
} from "@/types";
import type { JKFReader } from "@/interfaces";
import { getCurrentBranchMoves } from "./branch";
import { INITIAL_STATES } from "@/constants/boardPresets";

export class JKFAnalyzer implements JKFReader {
  // === JKFデータ取得 ===
  getMoveAt(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): JKFMove | null {
    // 1. 指定されたブランチパスから現在の分岐のmoves配列を取得
    const moves = getCurrentBranchMoves(jkf, branchPath);

    // 2. moveIndexが有効範囲内かチェック
    if (moveIndex < 0 || moveIndex >= moves.length) {
      return null;
    }

    // 3. 指定されたインデックスの手を返す
    return moves[moveIndex];
  }

  getMovesRange(
    jkf: JKFData,
    fromIndex: number,
    toIndex: number,
    branchPath: JKFBranchPath,
  ): JKFMove[] {
    // 1. 指定されたブランチパスから分岐のmoves配列を取得
    const moves = getCurrentBranchMoves(jkf, branchPath);

    // 2. インデックス妥当性
    if (fromIndex < 0 || toIndex < fromIndex) {
      return [];
    }

    // 3. 範囲が配列の長さを超える場合は調整
    const safeFromIndex = Math.max(0, fromIndex);
    const safeToIndex = Math.min(moves.length - 1, toIndex);

    // 4. 指定された範囲の手を返す(toIndexは含む)
    return moves.slice(safeFromIndex, safeToIndex + 1);
  }

  getAvailableForks(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Array<{ forkIndex: number; firstMove: JKFMove; totalMoves: number }> {
    const move = this.getMoveAt(jkf, moveIndex, branchPath);

    if (!move || !move.forks || move.forks.length === 0) {
      return [];
    }

    return move.forks.map((fork, index) => ({
      forkIndex: index,
      firstMove: fork[0], // 分岐の最初の手
      totalMoves: fork.length, // 分岐内の総手数
    }));
  }

  getCommentsAt(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): string[] {
    const move = this.getMoveAt(jkf, moveIndex, branchPath);

    if (!move || !move.comments) {
      return [];
    }

    if (Array.isArray(move.comments)) {
      return move.comments;
    }

    // commentsが文字列の場合
    return [move.comments];
  }

  getSpecialAt(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): JKFSpecialType | null {
    // 1. 指定されたインデックスの手を取得
    const move = this.getMoveAt(jkf, moveIndex, branchPath);

    // 2. 手が存在しない、またはspecialがない場合はnull
    if (!move || !move.special) {
      return null;
    }

    // 3. 文字列から型安全な列挙体に変換
    if (isValidJKFSpecial(move.special)) {
      return move.special;
    }

    // 4. 未知のspecial値の場合はnull（ログ出力も検討）
    console.warn(`Unknown JKF special value: ${move.special}`);
    return null;
  }

  getHeader(jkf: JKFData): { [key: string]: string } {
    if (!jkf.header) {
      return {};
    }

    return jkf.header;
  }

  getInitialState(jkf: JKFData): JKFState | null {
    if (!jkf.initial) {
      return INITIAL_STATES.HIRATE;
    }

    if (jkf.initial.preset) {
      if (jkf.initial.preset === "OTHER") {
        return jkf.initial.data || null;
      }
      return INITIAL_STATES[jkf.initial.preset as InitialPresetString];
    }

    if (jkf.initial.data) {
      return jkf.initial.data;
    }

    return INITIAL_STATES.HIRATE;
  }
}
