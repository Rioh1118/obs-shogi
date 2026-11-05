import type { ReactNode } from "react";
import { EngineProvider } from "@/entities/engine";
import { useEnginePresets } from "@/entities/engine-presets";

export function EngineRuntimeGate({ children }: { children: ReactNode }) {
  const { runtimeConfig, selectedPreset } = useEnginePresets();
  return (
    <EngineProvider
      desiredRuntime={runtimeConfig ?? null}
      presetIncomplete={selectedPreset !== null && !runtimeConfig}
    >
      {children}
    </EngineProvider>
  );
}
