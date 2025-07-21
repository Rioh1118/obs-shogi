import type { Branch, BranchMove, BranchCalculationResult } from '@/types/branch';

export class BranchCalculator {
  constructor(private jkfPlayer: any) {}

  /**
   * 指定された手数での分岐を計算する
   */
  calculateBranchesAtTesuu(tesuu: number): BranchCalculationResult {
    if (!this.jkfPlayer) {
      return { branches: [], hasMore: false, error: 'JKF Player not available' };
    }

    try {
      // console.log(`🔍 分岐計算開始: tesuu=${tesuu}`);
      
      const targetTesuu = tesuu + 1;
      const moveFormat = this.jkfPlayer["getMoveFormat"]?.(targetTesuu);
      
      if (!moveFormat?.forks || moveFormat.forks.length === 0) {
        // console.log(`分岐なし: tesuu=${targetTesuu}`);
        return { branches: [], hasMore: false };
      }

      // console.log(`分岐発見: tesuu=${targetTesuu}, 分岐数=${moveFormat.forks.length}`);

      // 本譜の手を取得（重複排除用）
      const mainLineMove = moveFormat.move;
      const mainLineMoveKey = this.createMoveKey(mainLineMove);

      const branches: Branch[] = [];
      const seenMoves = new Set<string>();

      moveFormat.forks.forEach((fork: any, forkIndex: number) => {
        const branchData = this.analyzeFork(fork, forkIndex, tesuu, mainLineMoveKey, seenMoves);
        if (branchData) {
          branches.push(branchData);
        }
      });

      // console.log(`分岐計算完了: ${branches.length}個の分岐`);
      return { branches, hasMore: false };

    } catch (error) {
      console.error('分岐計算エラー:', error);
      return { branches: [], hasMore: false, error: String(error) };
    }
  }

  /**
   * フォークデータを解析してBranchオブジェクトを作成
   */
  private analyzeFork(
    fork: any[], 
    forkIndex: number, 
    startTesuu: number, 
    mainLineMoveKey: string | null,
    seenMoves: Set<string>
  ): Branch | null {
    if (!fork || fork.length === 0) return null;

    const firstMove = fork[0]?.move;
    if (!firstMove) return null;

    // 重複チェック
    const moveKey = this.createMoveKey(firstMove);
    if (mainLineMoveKey && moveKey === mainLineMoveKey) {
      // console.log(`本譜と重複: ${moveKey}`);
      return null;
    }
    if (seenMoves.has(moveKey)) {
      // console.log(`既出の手: ${moveKey}`);
      return null;
    }
    seenMoves.add(moveKey);

    // 分岐の手順を解析
    const moves: BranchMove[] = [];
    let currentTesuu = startTesuu + 1;

    for (const moveData of fork) {
      if (moveData?.move) {
        moves.push({
          move: moveData.move,
          tesuu: currentTesuu,
          description: this.formatMove(moveData.move)
        });
        currentTesuu++;
      }
    }

    // console.log(`分岐${forkIndex + 1}解析完了: ${moves.length}手, 開始手数=${startTesuu + 1}`);

    return {
      id: `branch-${startTesuu}-${forkIndex}`,
      startTesuu,
      length: moves.length,
      moves,
      firstMove,
      forkIndex,
      forkPointers: [{
        forkIndex,
        moveIndex: 0
      }]
    };
  }

  /**
   * 手の一意キーを作成
   */
  private createMoveKey(move: any): string {
    if (!move) return 'null';
    return `${move.from?.x || 'null'}-${move.from?.y || 'null'}-${move.to.x}-${move.to.y}-${move.piece}`;
  }

  /**
   * 手を読みやすい形式でフォーマット
   */
  private formatMove(move: any): string {
    try {
      return this.jkfPlayer?.constructor["moveToReadableKifu"]?.({ move }) || String(move);
    } catch {
      return String(move);
    }
  }
}
