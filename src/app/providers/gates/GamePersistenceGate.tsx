import type { ReactNode } from "react";
import { useMemo } from "react";
import { GameProvider, type GamePersistence } from "@/entities/game";
import { saveKifuToFile, type JKFData } from "@/entities/kifu";
import { GameFileTreeBridge } from "../bridges/GameFileTreeBridge";
import { useFileTree } from "@/entities/file-tree";

export function GamePersistenceGate({ children }: { children: ReactNode }) {
  const { selectedNode, kifuFormat } = useFileTree();

  const persistence = useMemo<GamePersistence | undefined>(() => {
    if (!selectedNode || selectedNode.isDirectory) return undefined;
    if (!kifuFormat) return undefined;

    const path = selectedNode.path;
    const format = kifuFormat;

    return {
      save: (jkf: JKFData) => saveKifuToFile(jkf, path, format),
    };
  }, [selectedNode, kifuFormat]);

  return (
    <GameProvider persistence={persistence}>
      <GameFileTreeBridge />
      {children}
    </GameProvider>
  );
}
