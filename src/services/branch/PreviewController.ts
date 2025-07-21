import type { PreviewState, NavigationState, Branch, PreviewData } from '@/types/branch';
import { Piece, Color } from 'shogi.js';

export class PreviewController {
  constructor(private jkfPlayer: any) {}

  /**
   * プレビュー状態に基づいて局面データを生成
   */
  generatePreviewData(state: PreviewState, branches: Branch[]): PreviewData | null {
    if (!this.jkfPlayer) return null;

    try {
      // console.log(`🎬 プレビューデータ生成: tesuu=${state.tesuu}, branch=${state.branchIndex}, steps=${state.branchSteps}`);

      // 現在の状態を保存
      const originalTesuu = this.jkfPlayer.tesuu;
      const originalForkPointers = this.jkfPlayer.getForkPointers();

      // プレビュー位置に移動
      if (state.branchIndex === 0) {
        // メイン線
        this.jkfPlayer.goto(state.tesuu);
      } else {
        // 分岐線
        this.navigateToBranch(state, branches);
      }

      // 盤面データを取得
      const board = this.extractBoardData();
      const hands = this.extractHandsData();
      const turn = this.jkfPlayer.shogi.turn;
      const tesuu = this.jkfPlayer.tesuu;

      // console.log(`プレビューデータ生成完了: tesuu=${tesuu}, 駒数=${this.countPieces(board)}`);

      // 元の状態に復元
      this.jkfPlayer.goto(originalTesuu, originalForkPointers);

      return { board, hands, turn, tesuu };

    } catch (error) {
      console.error('プレビューデータ生成エラー:', error);
      return null;
    }
  }

  /**
   * 分岐に移動してプレビューを生成
   */
  private navigateToBranch(state: PreviewState, branches: Branch[]): void {
    if (state.branchIndex <= 0 || state.branchIndex > branches.length) {
      throw new Error(`Invalid branch index: ${state.branchIndex}`);
    }

    const branch = branches[state.branchIndex - 1];
    console.log(`🎯 分岐${state.branchIndex}に移動開始:`, {
      startTesuu: branch.startTesuu,
      branchSteps: state.branchSteps,
      branchLength: branch.length,
      forkPointers: branch.forkPointers
    });

    // 分岐開始点まで移動
    console.log(`📍 分岐開始点${branch.startTesuu}に移動`);
    this.jkfPlayer.goto(branch.startTesuu);

    // 分岐の手順を実際に指す（JKFPlayerのfork機能を使用）
    if (branch.forkPointers && branch.forkPointers.length > 0) {
      const forkPointer = branch.forkPointers[0];
      console.log(`🔀 フォーク実行:`, forkPointer);
      
      try {
        // JKFPlayerのfork機能で分岐に入る
        const moved = this.jkfPlayer.forward(forkPointer.forkIndex);
        if (!moved) {
          console.warn(`❌ フォーク移動失敗: forkIndex=${forkPointer.forkIndex}`);
        } else {
          console.log(`✅ フォーク移動成功: 現在手数=${this.jkfPlayer.tesuu}`);
        }
      } catch (error) {
        console.error(`❌ フォーク実行エラー:`, error);
      }
    }

    // 分岐内での追加移動
    if (state.branchSteps > 0) {
      const targetSteps = Math.min(state.branchSteps, branch.length - 1);
      console.log(`➡️ 分岐内で${targetSteps}手進行`);
      
      for (let step = 0; step < targetSteps; step++) {
        const moved = this.jkfPlayer.forward();
        if (!moved) {
          console.warn(`❌ 分岐内移動失敗: step=${step + 1}`);
          break;
        } else {
          console.log(`✅ 分岐内移動成功: step=${step + 1}, 現在手数=${this.jkfPlayer.tesuu}`);
        }
      }
    }
  }

  /**
   * 盤面データを抽出
   */
  private extractBoardData(): Piece[][] {
    const pieces: Piece[][] = [];
    let totalPieces = 0;

    for (let x = 1; x <= 9; x++) {
      pieces[x - 1] = [];
      for (let y = 1; y <= 9; y++) {
        const piece = this.jkfPlayer.shogi.get(x, y);
        pieces[x - 1][y - 1] = piece;
        if (piece) totalPieces++;
      }
    }

    console.log(`盤面データ抽出: 駒数=${totalPieces}`);
    return pieces;
  }

  /**
   * 手駒データを抽出
   */
  private extractHandsData(): { [key: number]: string[] } {
    const shogiHands = this.jkfPlayer.shogi.hands;
    
    const hands = {
      [Color.Black]: Array.from(shogiHands[Color.Black] || []).map((piece: any) => piece.kind),
      [Color.White]: Array.from(shogiHands[Color.White] || []).map((piece: any) => piece.kind)
    };

    console.log(`手駒データ抽出: 先手=${hands[Color.Black].length}枚, 後手=${hands[Color.White].length}枚`);
    return hands;
  }

  /**
   * 盤面の駒数をカウント
   */
  private countPieces(board: Piece[][]): number {
    let count = 0;
    for (const row of board) {
      for (const piece of row) {
        if (piece) count++;
      }
    }
    return count;
  }
}
