import type { ReactNode } from "react";
import { AppConfigProvider } from "@/entities/app-config";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppConfigProvider>
      <FileTreeRootGate>
        <GamePersistenceGate>{children}</GamePersistenceGate>
      </FileTreeRootGate>
    </AppConfigProvider>
  );
}
