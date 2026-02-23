import type { ReactNode } from "react";
import { useAppConfig } from "@/entities/app-config";
import { FileTreeProvider } from "@/entities/file-tree";

export function FileTreeRootGate({ children }: { children: ReactNode }) {
  const { config } = useAppConfig();

  return (
    <FileTreeProvider rootDir={config?.root_dir ?? null}>
      {children}
    </FileTreeProvider>
  );
}
