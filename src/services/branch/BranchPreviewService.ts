import { JKFPlayer } from "json-kifu-format";
import type { PositionNode, PreviewData } from "@/types/branch";
import { Color, Piece } from "shogi.js";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { isSameMove } from "@/utils/shogi-format";

// JKFのmoves[i].forks をプレビュー用に正規化
type JkfPreviewNode = {
  move?: IMoveMoveFormat;
  forks?: Array<{ move?: JkfPreviewNode[] } | JkfPreviewNode[]>;
};

function normalizeForkMoves(next?: JkfPreviewNode): JkfPreviewNode[][] {
  const fks = next?.forks ?? [];
  return fks
    .map((fk: any) => (Array.isArray(fk) ? fk : (fk?.moves ?? [])))
    .filter((arr: any) => Array.isArray(arr) && arr.length > 0);
}

export class BranchPreviewService {
  constructor(private readonly base: JKFPlayer) {}

  /**
   * 指定ノードのプレビューデータを作成
   * JKFPlayerの状態を一時的に変更し、元に戻す
   */
  generateNodePreview(
    node: PositionNode,
    pathToNode: PositionNode[],
  ): PreviewData | null {
    if (!this.base) return null;

    const jkf = new JKFPlayer(this.base.kifu);

    this.moveAlongPathByMoveMatch(jkf, pathToNode);

    // プレビューデータ
    const board = this.extractBoard(jkf);
    const hands = this.extractHands(jkf);
    const turn = jkf.shogi.turn as 0 | 1;

    return {
      board,
      hands,
      tesuu: node.tesuu,
      turn,
      nodeId: node.id,
    };
  }

  /**
   * childrenIds の順序や数に依存せず、手で前進する
   */
  private moveAlongPathByMoveMatch(j: JKFPlayer, path: PositionNode[]): void {
    j.goto(0);

    for (let i = 1; i < path.length; i++) {
      const targetMove = path[i].move!;
      this.stepOnceByMoveMatch(j, targetMove);
    }
  }

  /**
   * 現在 tesuu = t の局面から、次の一手をtargetMoveにしたい
   * 1) 本譜と一手 => forward()
   * 2) それ以外=> forks[k][0].moveと一致する kを探し => forkAndForward(k)
   */
  private stepOnceByMoveMatch(j: JKFPlayer, targetMove: IMoveMoveFormat): void {
    const t = j.tesuu;
    const next = j.kifu?.moves?.[t + 1] as JkfPreviewNode | undefined;

    if (!next) {
      console.warn(
        "[Preview] next is undefined at tesuu=",
        t,
        "target=",
        targetMove,
      );
      return;
    }

    // 1)本譜
    if (next.move && isSameMove(next.move, targetMove)) {
      j.forward();
      return;
    }

    // 2) forksの先頭手をチェック
    const forkLines = normalizeForkMoves(next);
    for (let k = 0; k < forkLines.length; k++) {
      const first = forkLines[k][0];
      if (first?.move && isSameMove(first.move, targetMove)) {
        j.forkAndForward(k);
        return;
      }
    }
    // 木とJKFがズレてる時
    console.warn(
      "[Preview] No matching move at tesuu=",
      t,
      "target=",
      targetMove,
      "next=",
      next,
    );
  }

  /**
   * 盤面情報を抽出 - Piece[][]型を返す
   */
  private extractBoard(j: JKFPlayer): Piece[][] {
    const board: Piece[][] = Array.from({ length: 9 }, () => Array<Piece>(9));

    const shogiInstance = j.shogi;

    for (let x = 1; x <= 9; x++) {
      for (let y = 1; y <= 9; y++) {
        const piece = shogiInstance.get(x, y);
        if (piece) {
          board[x - 1][y - 1] = piece;
        }
      }
    }

    return board;
  }

  /**
   * 持ち駒情報を抽出
   */
  private extractHands(j: JKFPlayer): { 0: string[]; 1: string[] } {
    const result: { 0: string[]; 1: string[] } = { 0: [], 1: [] };
    const shogiInstance = j.shogi;
    const hands = shogiInstance.hands;

    if (hands[Color.Black]) {
      result[0] = hands[Color.Black].map((p) => p.kind);
    }

    if (hands[Color.White]) {
      result[1] = hands[Color.White].map((p) => p.kind);
    }

    return result;
  }
}
