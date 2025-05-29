import { useGame } from "../../contexts//GameContext";
import IconButton from "../IconButton";

function GameControls() {
  const { goToStart, prevMove, nextMove, goToEnd, canGoBack, canGoForward } =
    useGame();

  return (
    <div className="game-controls">
      <IconButton
        handleClick={goToStart}
        disabled={!canGoBack}
        title="初期局面へ"
        ariaLabel="初期局面へ移動"
        variant="primary"
        size="medium"
      >
        ⏮
      </IconButton>
      <IconButton
        handleClick={prevMove}
        disabled={!canGoBack}
        title="前の手へ"
        ariaLabel="前の手へ移動"
        variant="primary"
        size="medium"
      >
        ◀
      </IconButton>

      <IconButton
        handleClick={nextMove}
        disabled={!canGoForward}
        title="次の手へ"
        ariaLabel="次の手へ移動"
        variant="primary"
        size="medium"
      >
        ▶
      </IconButton>

      <IconButton
        handleClick={goToEnd}
        disabled={!canGoForward}
        title="最終局面へ"
        ariaLabel="最終局面へ移動"
        variant="primary"
        size="medium"
      >
        ⏭
      </IconButton>
    </div>
  );
}
export default GameControls;
