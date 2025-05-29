import { useGame } from "../../contexts//GameContext";
import ControlButton from "./ControlButton";
import "./GameControls.scss";

function GameControls() {
  const { goToStart, prevMove, nextMove, goToEnd, canGoBack, canGoForward } =
    useGame();

  return (
    <div className="game-controls">
      <ControlButton
        handleClick={goToStart}
        disabled={!canGoBack}
        title="最初に戻る"
      >
        |&lt;
      </ControlButton>

      <ControlButton
        handleClick={prevMove}
        disabled={!canGoBack}
        title="前の手"
      >
        &lt;
      </ControlButton>

      <ControlButton
        handleClick={nextMove}
        disabled={!canGoForward}
        title="次の手"
      >
        &gt;
      </ControlButton>

      <ControlButton
        handleClick={goToEnd}
        disabled={!canGoForward}
        title="最後に進む"
      >
        &gt;|
      </ControlButton>
    </div>
  );
}
export default GameControls;
