import type { ReactNode } from "react";
import { useAppConfig } from "@/entities/app-config";
import { PositionSearchProvider } from "@/entities/search";

export function SearchRootGate({ children }: { children: ReactNode }) {
  const { config } = useAppConfig();

  return (
    <PositionSearchProvider rootDir={config?.root_dir ?? null}>{children}</PositionSearchProvider>
  );
}
