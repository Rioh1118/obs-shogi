import type {
  BranchNavigator,
  GameModeManager,
  GameStateEditor,
  GameStateNavigator,
  GameStateReader,
  MoveValidator,
  GameSelectionManager,
} from "@/interfaces";

export class GameService {
  private stateManager: GameStateReader & GameStateNavigator;
  private gameEditor: GameStateEditor;
  private branchManager: BranchNavigator;
  private modeManager: GameModeManager;
  private moveValidator: MoveValidator;
  private selectionManager: GameSelectionManager;

  constructor(
    stateManager: GameStateReader & GameStateNavigator,
    gameEditor: GameStateEditor,
    branchManager: BranchNavigator,
    modeManager: GameModeManager,
    selectionManager: GameSelectionManager,
    moveValidator: MoveValidator,
  ) {
    this.stateManager = stateManager;
    this.gameEditor = gameEditor;
    this.branchManager = branchManager;
    this.modeManager = modeManager;
    this.moveValidator = moveValidator;
    this.selectionManager = selectionManager;
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

  get selection() {
    return this.selectionManager;
  }
}
