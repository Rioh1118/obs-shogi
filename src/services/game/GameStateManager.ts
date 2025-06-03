import type { GameStateReader, GameStateNavigator } from "interfaces";
import type {
  GameState,
  GameProgress,
  SelectedPosition,
  GameMode,
} from "@/types/state";
import type {
  JKFData,
  JKFState,
  Shogi,
  ShogiMove,
  JKFBranchPath,
  BranchNavigationInfo,
  Color,
} from "@/types";
import { Ok, Err, type Result } from "@/types";
import {
  getTotalMovesInBranch,
  isAtBranchEnd,
  getNextValidIndex,
  getPreviousValidIndex,
  canNavigateToIndex,
  isValidBranchPath,
  getAvailableBranches,
  getBranchDepth,
} from "@/utils/branch";

export class GameStateManager implements GameStateReader, GameStateNavigator {
  private originalJKF: JKFData | null = null;
  private shogiGame: Shogi | null = null;
  private selectedPosition: SelectedPosition | null = null;
  private legalMoves: ShogiMove[] = [];
  private lastMove: ShogiMove | null = null;
  private mode: GameMode = "replay";
  private progress: GameProgress = {
    currentJKFIndex: 0,
    actualMoveCount: 0,
    currentBranchPath: {
      mainMoveIndex: 0,
      forkHistory: [],
    },
    totalMovesInBranch: 0,
    isAtBranchEnd: false,
  };
  private branchNavigation: BranchNavigationInfo = {
    currentPath: {
      mainMoveIndex: 0,
      forkHistory: [],
    },
    availableBranches: [],
    branchDepth: 0,
  };

  private isLoading: boolean = false;
  private error: string | null = null;

  // GameStateReader Impl
  getCurrentState(): JKFState | null {
    // TODO: shogiGameからJKFStateを生成
    return null;
  }

  getCurrentMoveIndex(): number {
    return this.progress.currentJKFIndex;
  }

  getTotalMoves(): number {
    if (!this.originalJKF) return 0;
    return getTotalMovesInBranch(
      this.originalJKF,
      this.progress.currentBranchPath,
    );
  }

  getCurrentTurn(): Color | null {
    // TODO: shogiGameから現在の手番を取得
    return null;
  }

  isGameLoaded(): boolean {
    return this.originalJKF !== null && this.shogiGame !== null;
  }

  isAtStart(): boolean {
    return this.progress.currentJKFIndex === 0;
  }

  isAtEnd(): boolean {
    if (!this.originalJKF) {
      return false;
    }

    return isAtBranchEnd(
      this.originalJKF,
      this.progress.currentBranchPath,
      this.progress.currentJKFIndex,
    );
  }

  // GameStateNavigator implementation
  nextElement(): Result<GameState, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    const nextIndex = getNextValidIndex(
      this.originalJKF!,
      this.progress.currentBranchPath,
      this.progress.currentJKFIndex,
    );

    if (nextIndex === null) {
      return Err("Cannot move to next");
    }

    this.progress.currentJKFIndex = nextIndex;
    this.updateBranchNavigationo();

    return Ok(undefined);
  }

  previousElement(): Result<GameState, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }
    const previousIndex = getPreviousValidIndex(
      this.originalJKF!,
      this.progress.currentBranchPath,
      this.progress.currentJKFIndex,
    );

    if (previousIndex === null) {
      return Err("Cannot move to previous");
    }

    this.progress.currentJKFIndex = previousIndex;
    this.updateBranchNavigation();

    return Ok(undefined);
  }

  // 内部メソッド: ブランチナビゲーション情報を更新
  private updateBranchNavigation(): void {
    if (!this.originalJKF) return;

    this.branchNavigation = {
      currentPath: this.progress.currentBranchPath,
      availableBranches: getAvailableBranches(
        this.originalJKF,
        this.progress.currentJKFIndex,
      ),
      branchDepth: getBranchDepth(this.progress.currentBranchPath),
    };

    this.progress.totalMovesInBranch = getTotalMovesInBranch(
      this.originalJKF,
      this.progress.currentBranchPath,
    );

    this.progress.isAtBranchEnd = isAtBranchEnd(
      this.originalJKF,
      this.progress.currentBranchPath,
      this.progress.currentJKFIndex,
    );
  }

  goToStart(): Result<void, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    // TODO: 開始局面に戻る処理
    this.progress.currentJKFIndex = 0;

    return Ok(undefined);
  }

  goToEnd(): Result<void, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    // TODO: 最終局面に進む処理
    this.progress.currentJKFIndex = this.progress.totalMovesInBranch;
    this.progress.isAtBranchEnd = true;

    return Ok(undefined);
  }

  goToJKFIndex(index: number): Result<void, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    if (index < 0 || index > this.progress.totalMovesInBranch) {
      return Err("Invalid index");
    }

    // TODO: 指定インデックスに移動する処理
    this.progress.currentJKFIndex = index;

    return Ok(undefined);
  }

  goToJKFIndexWithBranch(
    index: number,
    branchPath: JKFBranchPath,
  ): Result<void, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    // TODO: 分岐を考慮した移動処理
    this.progress.currentJKFIndex = index;
    this.progress.currentBranchPath = branchPath;

    return Ok(undefined);
  }

  // React用：現在の状態を取得
  getCurrentGameState(): GameState {
    return {
      originalJKF: this.originalJKF,
      shogiGame: this.shogiGame,
      selectedPosition: this.selectedPosition,
      legalMoves: this.legalMoves,
      lastMove: this.lastMove,
      mode: this.mode,
      progress: this.progress,
      branchNavigation: this.branchNavigation,
      isLoading: this.isLoading,
      error: this.error,
    };
  }

  // 内部状態更新用メソッド（他のクラスから使用）
  setJKFData(jkf: JKFData): void {
    this.originalJKF = jkf;
  }

  setShogiGame(shogi: Shogi): void {
    this.shogiGame = shogi;
  }

  setSelectedPosition(position: SelectedPosition | null): void {
    this.selectedPosition = position;
  }

  setLegalMoves(moves: ShogiMove[]): void {
    this.legalMoves = moves;
  }

  setLastMove(move: ShogiMove | null): void {
    this.lastMove = move;
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
  }

  setError(error: string | null): void {
    this.error = error;
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }
}
