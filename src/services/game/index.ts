import type {
  BranchNavigator,
  GameModeManager,
  GameStateEditor,
  GameStateNavigator,
  GameStateReader,
  MoveValidator,
} from "@/interfaces";

export class GameService {
  private stateManager: GameStateReader & GameStateNavigator;
  private gameEditor: GameStateEditor;
  private branchManager: BranchNavigator;
  private modeManager: GameModeManager;
  private moveValidator: MoveValidator;

  constructor(
    stateManager: GameStateReader & GameStateNavigator,
    gameEditor: GameStateEditor,
    branchManager: BranchNavigator,
    modeManager: GameModeManager,
    moveValidator: MoveValidator,
  ) {
    this.stateManager = stateManager;
    this.gameEditor = gameEditor;
    this.branchManager = branchManager;
    this.modeManager = modeManager;
    this.moveValidator = moveValidator;
  }

  get state() {
    return this.stateManager;
  }
  get editor() {
    return this.gameEditor;
  }
  get branch() {
    return this.branchManager;
  }
  get mode() {
    return this.modeManager;
  }
  get validator() {
    return this.moveValidator;
  }
}

// export function createGameService(): GameService {
//
// }
