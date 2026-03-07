import { useEffect } from "react";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import { useGame } from "@/entities/game";

export function GameFileTreeBridge() {
  const { activeKifuPath, jkfData, kifuFormat } = useFileTree();
  const { loadGame, resetGame } = useGame();

  useEffect(() => {
    const run = async () => {
      if (activeKifuPath && jkfData && kifuFormat) {
        await loadGame(jkfData, activeKifuPath);
      } else {
        resetGame();
      }
    };
    void run();
  }, [activeKifuPath, jkfData, kifuFormat, loadGame, resetGame]);

  return null;
}
