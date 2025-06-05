import type { GameStateReader, GameStateNavigator } from "interfaces";
import type {
  GameState,
  GameProgress,
  SelectedPosition,
  GameMode,
} from "@/types/state";
import type {
  JKFData,
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
  getAvailableBranches,
  getBranchDepth,
  canNavigateToIndex,
  isValidBranchPath,
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

  constructor() {
    this.updateBranchNavigation();
  }

  // GameStateReader Impl
  getCurrentState(): GameState {
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
    return this.shogiGame?.turn ?? null;
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
    this.updateBranchNavigation();

    return Ok(this.getCurrentState());
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

    return Ok(this.getCurrentState());
  }

  // 内部メソッド: ブランチナビゲーション情報を更新
  private updateBranchNavigation(): void {
    if (!this.originalJKF) {
      this.branchNavigation = {
        currentPath: this.progress.currentBranchPath,
        availableBranches: [],
        branchDepth: 0,
      };

      this.progress.totalMovesInBranch = 0;
      this.progress.isAtBranchEnd = false;
      this.progress.actualMoveCount = 0;
      return;
    }

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

  goToStart(): Result<GameState, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    this.progress.currentJKFIndex = 0;
    this.updateBranchNavigation();

    return Ok(this.getCurrentState());
  }

  goToEnd(): Result<GameState, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    const totalMoves = getTotalMovesInBranch(
      this.originalJKF!,
      this.progress.currentBranchPath,
    );

    if (totalMoves === 0) {
      return Err("No moves in current branch");
    }
    this.progress.currentJKFIndex = totalMoves - 1;
    this.updateBranchNavigation();

    return Ok(this.getCurrentState());
  }

  goToJKFIndex(index: number): Result<GameState, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    if (
      !canNavigateToIndex(
        this.originalJKF!,
        this.progress.currentBranchPath,
        index,
      )
    ) {
      return Err("Invalid index");
    }

    this.progress.currentJKFIndex = index;
    this.updateBranchNavigation();

    return Ok(this.getCurrentState());
  }

  goToJKFIndexWithBranch(
    index: number,
    branchPath: JKFBranchPath,
  ): Result<GameState, string> {
    if (!this.isGameLoaded()) {
      return Err("Game not loaded");
    }

    if (!isValidBranchPath(this.originalJKF!, branchPath)) {
      return Err("Invalid branch path");
    }

    if (!canNavigateToIndex(this.originalJKF!, branchPath, index)) {
      return Err("Invalid index for branch");
    }

    this.progress.currentJKFIndex = index;
    this.progress.currentBranchPath = branchPath;
    this.updateBranchNavigation();

    return Ok(this.getCurrentState());
  }

  // 内部状態更新用メソッド（他のクラスから使用）
  setJKFData(jkf: JKFData): void {
    this.originalJKF = jkf;
    this.updateBranchNavigation();
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

  // 既存のsetterメソッドに追加
  setProgress(progress: GameProgress): void {
    this.progress = progress;
    this.updateBranchNavigation();
  }

  setBranchNavigation(branchNavigation: BranchNavigationInfo): void {
    this.branchNavigation = branchNavigation;
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

  // 初期化用の便利メソッド
  initializeFromJKF(
    jkf: JKFData,
    shogiGame: Shogi,
    initialBranchPath: JKFBranchPath,
  ): void {
    this.originalJKF = jkf;
    this.shogiGame = shogiGame;
    this.selectedPosition = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.mode = "analysis";

    // progressを初期化
    this.progress = {
      currentJKFIndex: 0,
      actualMoveCount: 0,
      currentBranchPath: initialBranchPath,
      totalMovesInBranch: getTotalMovesInBranch(jkf, initialBranchPath),
      isAtBranchEnd: isAtBranchEnd(jkf, initialBranchPath, 0),
    };

    this.isLoading = false;
    this.error = null;

    // branchNavigationを更新
    this.updateBranchNavigation();
  }
}
