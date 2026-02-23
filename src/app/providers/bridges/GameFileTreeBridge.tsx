import { useEffect } from "react";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import { useGame } from "@/entities/game";

export function GameFileTreeBridge() {
  const { selectedNode, jkfData, isKifuSelected } = useFileTree();
  const { loadGame, resetGame } = useGame();

  useEffect(() => {
    const run = async () => {
      if (isKifuSelected() && jkfData) {
        const absPath =
          selectedNode && !selectedNode.isDirectory ? selectedNode.path : null;
        await loadGame(jkfData, absPath);
      } else {
        resetGame();
      }
    };
    void run();
  }, [selectedNode, jkfData, isKifuSelected, loadGame, resetGame]);

  return null;
}
