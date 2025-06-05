import { GameService } from "./GameService";
import { GameStateManager } from "./GameStateManager";
import { GameEditor } from "./GameEditor";
import { BranchManager } from "./BranchManager";
import { GameModeController } from "./GameController";
import { SelectionCoordinator } from "./SelectionCoordinator";
import { JKFAnalyzer } from "@/utils/JKFAnalyzer";
import { JKFEditorImpl } from "@/utils/JKFEditorImpl";
import { MoveValidatorImpl } from "./MoveValidatorImpl";

export class GameServiceFactory {
  /**
   * GameServiceの完全なインスタンスを作成
   */
  static createGameService(): GameService {
    const jkfReader = new JKFAnalyzer();
    const jkfEditor = new JKFEditorImpl();

    const moveValidator = new MoveValidatorImpl();

    // 1. 中核となるGameStateManagerを作成
    const stateManager = new GameStateManager();

    // 2. 各種マネージャーを作成
    const gameEditor = new GameEditor(
      jkfEditor,
      jkfReader,
      moveValidator,
      stateManager,
    );

    const branchManager = new BranchManager(stateManager, jkfEditor);

    const modeManager = new GameModeController(stateManager);

    const selectionManager = new SelectionCoordinator(stateManager);

    // 3. GameServiceを組み立てて返す
    return new GameService(
      stateManager,
      gameEditor,
      branchManager,
      modeManager,
      selectionManager,
      moveValidator,
    );
  }
}
