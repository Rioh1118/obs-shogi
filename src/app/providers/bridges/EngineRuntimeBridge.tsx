import React from "react";
import { EngineProvider } from "@/entities/engine";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";

export function EngineRuntimeBridge({ children }: { children: React.ReactNode }) {
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
