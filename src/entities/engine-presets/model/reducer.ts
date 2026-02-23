import type { EnginePreset, EnginePresetsState, PresetId } from "./types";

type EnginePresetsAction =
  | { type: "loading" }
  | {
      type: "loaded";
      payload: { presets: EnginePreset[]; selectedPresetId: PresetId | null };
    }
  | { type: "error"; payload: string }
  | { type: "set_presets"; payload: EnginePreset[] }
  | { type: "set_selected"; payload: PresetId | null };

export function reducer(
  state: EnginePresetsState,
  action: EnginePresetsAction,
): EnginePresetsState {
  switch (action.type) {
    case "loading":
      return { ...state, status: "loading", error: null };
    case "loaded":
      return {
        status: "ok",
        error: null,
        presets: action.payload.presets,
        selectedPresetId: action.payload.selectedPresetId,
      };
    case "error":
      return { ...state, status: "error", error: action.payload };
    case "set_presets":
      return { ...state, presets: action.payload };
    case "set_selected":
      return { ...state, selectedPresetId: action.payload };
    default:
      return state;
  }
}
