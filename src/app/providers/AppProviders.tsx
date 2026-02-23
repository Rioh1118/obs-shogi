import { AppConfigProvider, useAppConfig } from "@/entities/app-config";
import { FileTreeProvider } from "@/entities/file-tree/model/provider";

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
      <FileTreeWithRoot>{children}</FileTreeWithRoot>
    </AppConfigProvider>
  );
}
