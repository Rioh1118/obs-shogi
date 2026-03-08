import type { ReactNode } from "react";
import { useMemo } from "react";
import { GameProvider, type GamePersistence } from "@/entities/game";
import { saveKifuToFile, type JKFData } from "@/entities/kifu";
import { GameFileTreeBridge } from "../bridges/GameFileTreeBridge";
import { useFileTree } from "@/entities/file-tree";

export function GamePersistenceGate({ children }: { children: ReactNode }) {
  const { activeKifuPath, kifuFormat } = useFileTree();

  const persistence = useMemo<GamePersistence | undefined>(() => {
    if (!activeKifuPath) return undefined;
    if (!kifuFormat) return undefined;

    return {
      save: (jkf: JKFData) => saveKifuToFile(jkf, activeKifuPath, kifuFormat),
    };
  }, [activeKifuPath, kifuFormat]);

  return (
    <GameProvider persistence={persistence}>
      <GameFileTreeBridge />
      {children}
    </GameProvider>
  );
}
