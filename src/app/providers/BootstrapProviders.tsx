import type { ReactNode } from "react";
import { AppConfigProvider } from "@/entities/app-config";

export function BootstrapProviders({ children }: { children: ReactNode }) {
  return <AppConfigProvider>{children}</AppConfigProvider>;
}
