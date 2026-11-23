import { useAppConfig } from "@/entities/app-config";
import { isPresetConfigured, useEnginePresets } from "@/entities/engine-presets";
import type { TabKey } from "./tabs";

/**
 * そのままではエンジンが動かないタブ。左の一覧に ⚠ を出す。
 *
 * **無くても動くもの（定跡、評価関数）では出さない。** いつも出ていると、直す必要があるときに読まれない。
 * AI ライブラリは、選んだフォルダがあるかだけを見る。中身を読むのはタブを開いたとき
 * （読めなかったことは、そのタブの中と、エンジンの起動の知らせが言う）。
 */
export function useSetupNeeds(): ReadonlySet<TabKey> {
  const { config } = useAppConfig();
  const { state } = useEnginePresets();

  const needs = new Set<TabKey>();
  if (config !== null && !config.ai_root?.trim()) needs.add("aiLibrary");

  const applied = state.presets.find((preset) => preset.id === state.selectedPresetId);
  if (state.status === "ok" && (!state.writable || !applied || !isPresetConfigured(applied))) {
    needs.add("engine");
  }

  return needs;
}
