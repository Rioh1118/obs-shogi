import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
} from "react";
import type { ReactNode } from "react";

import {
  type PresetId,
  type EnginePreset,
  type PresetsFile,
  type UsiOptionMap,
  type AnalysisDefaults,
  isPresetConfigured,
} from "@/types/enginePresets";
import { loadPresets, savePresets } from "@/commands/enginePresets";

import { useAppConfig } from "@/contexts/AppConfigContext";
import { DEFAULT_OPTIONS } from "@/commands/engine";
import type { EngineRuntimeConfig } from "@/types/engine";
import { derivePaths } from "@/utils/enginePresets";

type AsyncStatus = "idle" | "loading" | "ok" | "error";

type EnginePresetsState = {
  status: AsyncStatus;
  error: string | null;

  presets: EnginePreset[];
  selectedPresetId: PresetId | null;
};

type EnginePresetsAction =
  | { type: "loading" }
  | {
      type: "loaded";
      payload: { presets: EnginePreset[]; selectedPresetId: PresetId | null };
    }
  | { type: "error"; payload: string }
  | { type: "set_presets"; payload: EnginePreset[] }
  | { type: "set_selected"; payload: PresetId | null };

const initialState: EnginePresetsState = {
  status: "idle",
  error: null,
  presets: [],
  selectedPresetId: null,
};

function reducer(
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

function genPresetId(): PresetId {
  return crypto.randomUUID();
}

function clonePreset<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function createDefaultPreset(
  partial: Partial<EnginePreset> = {},
): EnginePreset {
  const id = partial.id ?? genPresetId();
  const base: EnginePreset = {
    id,
    label: "",

    aiName: "",
    enginePath: "",
    evalFilePath: "",
    bookEnabled: false,
    bookFilePath: null,
    options: { ...DEFAULT_OPTIONS },
    analysis: undefined,
  };

  const merged: EnginePreset = {
    ...base,
    ...partial,
    options: {
      ...base.options,
      ...(partial.options ?? {}),
    },
    analysis: partial.analysis ? { ...partial.analysis } : base.analysis,
  };
  if (!merged.bookEnabled) merged.bookFilePath = null;

  return merged;
}

function normalizeOnePreset(raw: Partial<EnginePreset>): EnginePreset {
  const p = createDefaultPreset(raw);

  p.label = (p.label ?? "").trim() || "";
  p.aiName = (p.aiName ?? "").trim();
  p.enginePath = (p.enginePath ?? "").trim();
  p.evalFilePath = (p.evalFilePath ?? "").trim();

  // book
  p.bookEnabled = Boolean(p.bookEnabled);
  if (!p.bookEnabled) {
    p.bookFilePath = null;
  } else {
    const bp = (p.bookFilePath ?? "").trim();
    p.bookFilePath = bp.length > 0 ? bp : null;
  }

  const nextOptions: UsiOptionMap = {};
  for (const [k, v] of Object.entries(p.options ?? {})) {
    const vv = String(v ?? "").trim();
    if (!vv) continue;
    nextOptions[k] = vv;
  }
  p.options = { ...DEFAULT_OPTIONS, ...nextOptions };

  if (p.analysis) {
    const a = { ...p.analysis };
    if (a.timeSeconds != null && a.timeSeconds <= 0) delete a.timeSeconds;
    if (a.depth != null && a.depth <= 0) delete a.depth;
    if (a.nodes != null && a.nodes <= 0) delete a.nodes;
    p.analysis = a;
  }

  return p;
}

function normalizeLoadedFile(file: PresetsFile | null): EnginePreset[] {
  const presets = file?.presets ?? [];
  const normalized = presets.map((p) => normalizeOnePreset(p));

  // id 重複の保険（もし壊れてたら再採番）
  const seen = new Set<string>();
  for (let i = 0; i < normalized.length; i++) {
    const id = normalized[i].id;
    if (!id || seen.has(id)) normalized[i].id = genPresetId();
    seen.add(normalized[i].id);
  }

  return normalized;
}

type EnginePresetsContextType = {
  state: EnginePresetsState;
  // derived
  selectedPreset: EnginePreset | null;
  runtimeConfig: EngineRuntimeConfig | null;
  analysisDefaults: AnalysisDefaults | null;

  // IO
  reload: () => Promise<void>;
  // operations
  selectPreset: (id: PresetId | null) => Promise<void>;
  createPreset: (partial?: Partial<EnginePreset>) => Promise<EnginePreset>;
  duplicatePreset: (id: PresetId) => Promise<EnginePreset | null>;
  updatePreset: (id: PresetId, patch: Partial<EnginePreset>) => Promise<void>;
  mergeOptions: (id: PresetId, partial: UsiOptionMap) => Promise<void>;
  deletePreset: (id: PresetId) => Promise<void>;
};

const PresetsContext = createContext<EnginePresetsContextType | null>(null);

export function EnginePresetsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const {
    config,
    isLoading: appConfigLoading,
    setLastPresetId,
  } = useAppConfig();

  const initializedRef = useRef(false);
  const aiRoot = config?.ai_root ?? null;

  const selectedPreset = useMemo(() => {
    if (!state.selectedPresetId) return null;
    return state.presets.find((p) => p.id === state.selectedPresetId) ?? null;
  }, [state.presets, state.selectedPresetId]);

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
    } catch (e) {
      dispatch({
        type: "error",
        payload: `presets の再読み込みに失敗しました: ${String(e)}`,
      });
    }
  }, [state.selectedPresetId, setLastPresetId]);

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
      await selectPreset(p.id);
      return p;
    },
    [persist, selectPreset, state.presets],
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
    },
    [persist, state.presets],
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
    ],
  );

  return (
    <PresetsContext.Provider value={value}>{children}</PresetsContext.Provider>
  );
}

export function useEnginePresets() {
  const ctx = useContext(PresetsContext);
  if (!ctx) throw new Error("usePresets must be used within PresetsProvider");
  return ctx;
}
