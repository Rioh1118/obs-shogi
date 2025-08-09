import { JKFPlayer } from "json-kifu-format";
import type { PositionNode, PreviewData } from "@/types/branch";
import { Color, Piece } from "shogi.js";

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

    // 現在の状態をバックアップ
    const backup = {
      tesuu: jkf.tesuu,
      forks: jkf.getForkPointers(),
    };

    try {
      // パスに沿って移動
      this.moveAlongPath(jkf, pathToNode);

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
    } finally {
      jkf.goto(backup.tesuu, backup.forks);
    }
  }

  /**
   * ノードパスに沿ってJKFPlayerを移動
   */
  private moveAlongPath(j: JKFPlayer, path: PositionNode[]): void {
    j.goto(0);

    for (let i = 1; i < path.length; i++) {
      const node = path[i];
      const parent = path[i - 1];
      const childIndex = parent.childrenIds.indexOf(node.id);

      if (childIndex === 0) {
        j.forward();
      } else if (childIndex > 0) {
        j.forkAndForward(childIndex - 1);
      }
    }
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
