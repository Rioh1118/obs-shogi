import type {
  EnginePreset,
  EnginePresetsState,
  PresetId,
  PresetsLoadNotice,
  SaveFailure,
} from "./types";

type EnginePresetsAction =
  | { type: "loading" }
  | {
      type: "loaded";
      payload: {
        presets: EnginePreset[];
        selectedPresetId: PresetId | null;
        writable: boolean;
        unreadableCount: number;
        loadNotice: PresetsLoadNotice | null;
        /** 読み込みの中で書けなかった理由（既定の1件）。無ければ `null` */
        saveFailure: SaveFailure | null;
      };
    }
  | { type: "error"; payload: string }
  | { type: "set_presets"; payload: EnginePreset[] }
  | { type: "save_failed"; payload: SaveFailure }
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
        writable: action.payload.writable,
        unreadableCount: action.payload.unreadableCount,
        loadNotice: action.payload.loadNotice,
        loadSeq: state.loadSeq + 1,
        saveFailure: action.payload.saveFailure,
      };
    case "error":
      return { ...state, status: "error", error: action.payload };
    // 書けた後にだけ撃つ（悲観更新）。直前の失敗は解消した
    case "set_presets":
      return { ...state, presets: action.payload, saveFailure: null };
    case "save_failed":
      return { ...state, saveFailure: action.payload };
    case "set_selected":
      return { ...state, selectedPresetId: action.payload };
    default:
      return state;
  }
}
