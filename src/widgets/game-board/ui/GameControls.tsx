import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast } from "lucide-react";
import ControlButton from "@/shared/ui/ControlButton";
import "./GameControls.scss";
import { useGame } from "@/entities/game";

const ICON_SIZE = 20;

/** 棋譜の中の移動。最初、前の手、次の手、最後。キーでも同じことをする（`useKifuNavigationKeys`） */
function GameControls() {
  const { goToStart, previousMove, nextMove, goToEnd, canGoBackward, canGoForward } = useGame();

  const canGoBack = canGoBackward();
  const canGoNext = canGoForward();

  return (
    <div className="game-controls">
      <ControlButton onClick={goToStart} disabled={!canGoBack} title="最初に戻る（Home）">
        <ChevronFirst size={ICON_SIZE} aria-hidden="true" />
      </ControlButton>

      <ControlButton onClick={previousMove} disabled={!canGoBack} title="前の手（←）">
        <ChevronLeft size={ICON_SIZE} aria-hidden="true" />
      </ControlButton>

      <ControlButton onClick={nextMove} disabled={!canGoNext} title="次の手（→）">
        <ChevronRight size={ICON_SIZE} aria-hidden="true" />
      </ControlButton>

      <ControlButton onClick={goToEnd} disabled={!canGoNext} title="最後に進む（End）">
        <ChevronLast size={ICON_SIZE} aria-hidden="true" />
      </ControlButton>
    </div>
  );
}
export default GameControls;
