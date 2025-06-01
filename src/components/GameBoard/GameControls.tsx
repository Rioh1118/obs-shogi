import { useGame } from "../../contexts//GameContext";
import ControlButton from "./ControlButton";
import "./GameControls.scss";

function GameControls() {
  const { operations, hasNextMove, hasPreviousMove } = useGame();

  const canGoBack = hasPreviousMove();
  const canGoForward = hasNextMove();

  return (
    <div className="game-controls">
      <ControlButton
        handleClick={operations.goToStart}
        disabled={!canGoBack}
        title="最初に戻る"
      >
        |&lt;
      </ControlButton>

      <ControlButton
        handleClick={operations.previousMove}
        disabled={!canGoBack}
        title="前の手"
      >
        &lt;
      </ControlButton>

      <ControlButton
        handleClick={operations.nextMove}
        disabled={!canGoForward}
        title="次の手"
      >
        &gt;
      </ControlButton>

      <ControlButton
        handleClick={operations.goToEnd}
        disabled={!canGoForward}
        title="最後に進む"
      >
        &gt;|
      </ControlButton>
    </div>
  );
}
export default GameControls;
