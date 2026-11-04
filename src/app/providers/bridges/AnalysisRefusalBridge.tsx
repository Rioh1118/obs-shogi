import { useEffect, useRef } from "react";
import { refusalNeedsRestart, useAnalysis } from "@/entities/analysis";
import { useEngine } from "@/entities/engine";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { useEngineSettingsAction } from "./useEngineSettingsAction";

/** 帯の取っ手。断りが消えたら引っ込める */
const ANALYSIS_REFUSAL = "analysis-refusal";

/**
 * 検討の断りを帯で届ける（`docs/state-transitions/engine-standardization.md` の ※6）。
 *
 * **操作列の語は `待機中` のまま変えない。** ▶ の失敗は状態ではなく、次の ▶ で消える出来事なので、
 * 文は帯だけが持つ（案D）。
 */
export function AnalysisRefusalBridge() {
  const { state } = useAnalysis();
  const { initialize } = useEngine();
  const { notify, dismissByKey } = useNotify();
  const openSettings = useEngineSettingsAction();
  const { error } = state;

  // 押されるのは通知に積まれたあと。依存に入れると、閉じた帯が画面を動かすたびに戻る
  const startAgain = useRef(initialize);
  useEffect(() => {
    startAgain.current = initialize;
  }, [initialize]);

  useEffect(() => {
    if (!error) return;

    const action = refusalNeedsRestart(error)
      ? {
          label: "再起動",
          run: async () => {
            await startAgain.current();
          },
        }
      : openSettings;
    notify({
      tier: "warning",
      presentation: "banner",
      dismissKey: ANALYSIS_REFUSAL,
      title: "検討を続けられません",
      body: error,
      actions: [action],
    });
    return () => dismissByKey(ANALYSIS_REFUSAL);
  }, [error, openSettings, notify, dismissByKey]);

  return null;
}
