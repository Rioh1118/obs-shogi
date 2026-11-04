import { useEffect } from "react";
import { useEngine } from "@/entities/engine";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { startWarningBody } from "./startWarningNotice";
import { useEngineSettingsAction } from "./useEngineSettingsAction";

/** 起動で送らなかった設定があることの取っ手。次の起動で置き換える */
const ENGINE_START_WARNINGS = "engine-start-warnings";

/**
 * 起動はできたが、保存した設定の一部を送らなかった・変えて送ったことを伝える
 * （`useEngine().state.startWarnings`。何を送るかは Rust がその回の申告から決める。`binding.rs`）。
 *
 * **起動の失敗とは別の橋**（失敗は `EngineFailureBridge`）。起動はできているので帯にしない。
 * 直すのはプリセットなので「設定を開く」を持たせ、次の起動で置き換える。
 * 文言は種類ごとの表（`startWarningNotice.ts`）から組み、出さない種類だけなら何も出さない。
 */
export function EngineStartWarningBridge() {
  const { state } = useEngine();
  const { notify, dismissByKey } = useNotify();
  const openSettings = useEngineSettingsAction();

  const { phase, startWarnings } = state;

  useEffect(() => {
    if (phase !== "ready" || startWarnings.length === 0) return;
    console.info("[engine] 送らなかった・変えて送った設定", startWarnings);
    const body = startWarningBody(startWarnings);
    if (!body) return;
    notify({
      tier: "info",
      presentation: "toast",
      dismissKey: ENGINE_START_WARNINGS,
      title: "保存した設定の一部を、そのままでは送っていません",
      body,
      actions: [openSettings],
    });
    return () => dismissByKey(ENGINE_START_WARNINGS);
  }, [phase, startWarnings, openSettings, notify, dismissByKey]);

  return null;
}
