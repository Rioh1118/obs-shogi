import React from "react";
import { EngineProvider } from "@/entities/engine";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";

export function EngineRuntimeBridge({
  children,
}: {
  children: React.ReactNode;
}) {
  const { runtimeConfig } = useEnginePresets();
  return (
    <EngineProvider desiredRuntime={runtimeConfig ?? null}>
      {children}
    </EngineProvider>
  );
}
