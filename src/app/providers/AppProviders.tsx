import { AppConfigProvider, useAppConfig } from "@/entities/app-config";
import { FileTreeProvider } from "@/entities/file-tree/model/provider";
import { GameFileTreeBridge } from "./GameFileTreeBridge";
import { saveKifuToFile, type JKFData } from "@/entities/kifu";
import { useMemo, type ReactNode } from "react";
import { GameProvider, type GamePersistence } from "@/entities/game";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";

function GameProviderWithPersistence({ children }: { children: ReactNode }) {
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

function FileTreeWithRoot({ children }: { children: React.ReactNode }) {
  const { config } = useAppConfig();
  return (
    <FileTreeProvider rootDir={config?.root_dir ?? null}>
      {children}
    </FileTreeProvider>
  );
}

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppConfigProvider>
      <FileTreeWithRoot>
        <GameProviderWithPersistence>{children}</GameProviderWithPersistence>
      </FileTreeWithRoot>
    </AppConfigProvider>
  );
}
