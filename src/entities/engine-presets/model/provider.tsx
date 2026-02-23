import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { reducer } from "./reducer";
import {
  initialState,
  isPresetConfigured,
  type AnalysisDefaults,
  type EnginePreset,
  type EnginePresetsContextType,
  type PresetId,
  type UsiOptionMap,
} from "./types";
import { useAppConfig } from "@/entities/app-config";
import { loadPresets, savePresets } from "../api/presets";
import {
  clonePreset,
  createDefaultPreset,
  genPresetId,
  normalizeLoadedFile,
  normalizeOnePreset,
} from "../lib/normalize";
import { EnginePresetsContext } from "./context";
import { derivePaths } from "../lib/derivePath";
import type { EngineRuntimeConfig } from "@/entities/engine/model/types";

export function EnginePresetsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const {
    config,
    isLoading: appConfigLoading,
    setLastPresetId,
  } = useAppConfig();

  const initializedRef = useRef(false);
  const aiRoot = config?.ai_root ?? null;

  const presetVersionRef = useRef<Map<PresetId, number>>(new Map());
  const [versionEpoch, bumpVersionEpoch] = useReducer((x) => x + 1, 0);

  const touchPreset = useCallback((id: PresetId | null) => {
    if (!id) return;
    const m = presetVersionRef.current;
    m.set(id, (m.get(id) ?? 0) + 1);
    bumpVersionEpoch();
  }, []);

  const selectedPreset = useMemo(() => {
    if (!state.selectedPresetId) return null;
    return state.presets.find((p) => p.id === state.selectedPresetId) ?? null;
  }, [state.presets, state.selectedPresetId]);

  const selectedPresetVersion = useMemo(() => {
    void versionEpoch;
    const id = state.selectedPresetId;
    if (!id) return 0;
    return presetVersionRef.current.get(id) ?? 0;
  }, [state.selectedPresetId, versionEpoch]);

  const persist = useCallback(async (presets: EnginePreset[]) => {
    try {
      await savePresets({ presets });
    } catch (e) {
      console.error("savePresets failed:", e);
      throw e;
    }
  }, []);

  const runtimeConfig = useMemo<EngineRuntimeConfig | null>(() => {
    if (!selectedPreset) return null;
    if (!aiRoot) return null;
    if (!isPresetConfigured(selectedPreset)) return null;

    const { evalDir, bookDir, workDir } = derivePaths(selectedPreset, aiRoot);

    return {
      enginePath: selectedPreset.enginePath, // absolute
      workDir, // join(aiRoot, aiName)
      evalDir, // parent(evalFilePath)
      bookDir, // parent(bookFilePath) or null
      bookFile: selectedPreset.bookEnabled ? selectedPreset.bookFilePath : null,
      options: selectedPreset.options,
    };
  }, [selectedPreset, aiRoot]);

  const analysisDefaults = useMemo<AnalysisDefaults | null>(() => {
    if (!selectedPreset) return null;

    const a = selectedPreset.analysis;

    return {
      timeSeconds: a?.timeSeconds,
      depth: a?.depth,
      nodes: a?.nodes,
      mateSearch: a?.mateSearch ?? false,
    };
  }, [selectedPreset]);

  const chooseInitialSelectedId = useCallback(
    (presets: EnginePreset[]): PresetId | null => {
      const preferred = config?.last_preset_id ?? null;
      const exists = preferred && presets.some((p) => p.id === preferred);
      if (exists) return preferred!;
      return presets[0]?.id ?? null;
    },
    [config?.last_preset_id],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    if (appConfigLoading) return; // 初回だけ待つ
    initializedRef.current = true;

    (async () => {
      dispatch({ type: "loading" });
      try {
        const file = await loadPresets();
        let presets = normalizeLoadedFile(file);

        if (presets.length === 0) {
          const p = createDefaultPreset();
          presets = [p];
          await persist(presets);
        }

        const selectedId = chooseInitialSelectedId(presets);

        dispatch({
          type: "loaded",
          payload: { presets, selectedPresetId: selectedId },
        });

        if ((config?.last_preset_id ?? null) !== selectedId) {
          await setLastPresetId(selectedId);
        }
      } catch (e) {
        dispatch({
          type: "error",
          payload: `presets の読み込みに失敗しました: ${String(e)}`,
        });
      }
    })();
  }, [
    appConfigLoading,
    chooseInitialSelectedId,
    config?.last_preset_id,
    persist,
    setLastPresetId,
  ]);

  const reload = useCallback(async () => {
    dispatch({ type: "loading" });
    try {
      const file = await loadPresets();
      const presets = normalizeLoadedFile(file);

      const cur = state.selectedPresetId;
      const stillExists = cur && presets.some((p) => p.id === cur);
      const nextSelected = stillExists ? cur : (presets[0]?.id ?? null);

      dispatch({
        type: "loaded",
        payload: { presets, selectedPresetId: nextSelected },
      });
      await setLastPresetId(nextSelected);
      touchPreset(nextSelected);
    } catch (e) {
      dispatch({
        type: "error",
        payload: `presets の再読み込みに失敗しました: ${String(e)}`,
      });
    }
  }, [state.selectedPresetId, setLastPresetId, touchPreset]);

  const selectPreset = useCallback(
    async (id: PresetId | null) => {
      dispatch({ type: "set_selected", payload: id });
      await setLastPresetId(id);
    },
    [setLastPresetId],
  );

  const createPreset = useCallback(
    async (partial: Partial<EnginePreset> = {}) => {
      const p = createDefaultPreset({ label: "New Preset", ...partial });
      const next = [...state.presets, p];
      dispatch({ type: "set_presets", payload: next });
      await persist(next);
      touchPreset(p.id);
      return p;
    },
    [persist, state.presets, touchPreset],
  );

  const duplicatePreset = useCallback(
    async (id: PresetId) => {
      const src = state.presets.find((p) => p.id === id);
      if (!src) return null;

      const copy: EnginePreset = clonePreset(src);
      const nextPreset: EnginePreset = normalizeOnePreset({
        ...copy,
        id: genPresetId(),
        label: `${src.label} (copy)`,
      });
      const next = [...state.presets, nextPreset];
      dispatch({ type: "set_presets", payload: next });
      await persist(next);
      await selectPreset(nextPreset.id);
      return nextPreset;
    },
    [persist, selectPreset, state.presets],
  );

  const updatePreset = useCallback(
    async (id: PresetId, patch: Partial<EnginePreset>) => {
      const next = state.presets.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      );
      dispatch({ type: "set_presets", payload: next });
      await persist(next);
      touchPreset(id);
    },
    [persist, state.presets, touchPreset],
  );

  const mergeOptions = useCallback(
    async (id: PresetId, partial: UsiOptionMap) => {
      const next = state.presets.map((p) =>
        p.id === id ? { ...p, options: { ...p.options, ...partial } } : p,
      );
      dispatch({ type: "set_presets", payload: next });
      await persist(next);
    },
    [persist, state.presets],
  );

  const deletePreset = useCallback(
    async (id: PresetId) => {
      const next = state.presets.filter((p) => p.id !== id);
      dispatch({ type: "set_presets", payload: next });
      await persist(next);

      if (state.selectedPresetId === id) {
        const fallback = next[0]?.id ?? null;
        await selectPreset(fallback);
      }
    },
    [persist, selectPreset, state.presets, state.selectedPresetId],
  );

  const value: EnginePresetsContextType = useMemo(
    () => ({
      state,
      selectedPreset,
      runtimeConfig,
      analysisDefaults,
      selectedPresetVersion,
      reload,
      selectPreset,
      createPreset,
      duplicatePreset,
      updatePreset,
      mergeOptions,
      deletePreset,
    }),
    [
      runtimeConfig,
      analysisDefaults,
      state,
      selectedPreset,
      reload,
      selectPreset,
      createPreset,
      duplicatePreset,
      updatePreset,
      mergeOptions,
      deletePreset,
      selectedPresetVersion,
    ],
  );

  return (
    <EnginePresetsContext.Provider value={value}>
      {children}
    </EnginePresetsContext.Provider>
  );
}
