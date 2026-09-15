import type { ReactNode } from "react";
import { useMemo } from "react";
import { GameProvider, type GamePersistence } from "@/entities/game";
import { saveKifuToFile } from "@/entities/kifu/api/write";
import { type JKFData } from "@/entities/kifu/model/jkf";
import { GameFileTreeBridge } from "../bridges/GameFileTreeBridge";
import { useFileTree } from "@/entities/file-tree";
import type { MoveGate } from "@/entities/game";

/**
 * 盤の保存先を渡す器。
 *
 * **対局中の着手を通す門は受け取るだけ。** ここで組むと、この gate が
 * `GameSessionProvider` の内側にしか置けなくなり、**盤だけを試す場所から
 * 対局ごと持ち込むことになる**（門を渡さなければ盤は素通しで指せる）。
 */
export function GamePersistenceGate({
  children,
  moveGate,
}: {
  children: ReactNode;
  moveGate?: MoveGate;
}) {
  const { activeKifuPath, kifuFormat } = useFileTree();

  const persistence = useMemo<GamePersistence | undefined>(() => {
    if (!activeKifuPath) return undefined;
    if (!kifuFormat) return undefined;

    return {
      absPath: activeKifuPath,
      save: (jkf: JKFData) => saveKifuToFile(jkf, activeKifuPath, kifuFormat),
    };
  }, [activeKifuPath, kifuFormat]);

  return (
    <GameProvider persistence={persistence} moveGate={moveGate}>
      <GameFileTreeBridge />
      {children}
    </GameProvider>
  );
}
