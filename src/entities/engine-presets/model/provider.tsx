import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { reducer } from "./reducer";
import {
  initialState,
  type AnalysisDefaults,
  type EnginePreset,
  type EnginePresetsContextType,
  type PresetId,
  type SaveFailure,
  type UsiOptionMap,
} from "./types";
import { useAppConfig } from "@/entities/app-config";
import { loadPresets, savePresets } from "../api/presets";
import type { LoadedPresets } from "../api/rust-types";
import { asSaveFailure } from "../lib/saveFailure";
import {
  clonePreset,
  createDefaultPreset,
  genPresetId,
  normalizeLoadedPresets,
  normalizeOnePreset,
} from "../lib/normalize";
import { EnginePresetsContext } from "./context";
import { runtimeConfigOf } from "../lib/derivePath";
import type { EngineRuntimeConfig } from "@/entities/engine";

export function EnginePresetsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const { config, isLoading: appConfigLoading, setLastPresetId } = useAppConfig();

  const initializedRef = useRef(false);

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

  // 読んだ（か直前に書いた）ファイルの印。保存に渡し、別の書き手の変更を Rust が見分ける
  const revisionRef = useRef<string | null>(null);
  // 書けるか。**決めるのは読み込みだけ**なので `adopt` でだけ書き換える
  // （`state.writable` と同じ値。書く口を state に依存させないために ref で持つ）
  const writableRef = useRef(false);
  // 最後に読んだか書けた一覧。**次の一覧はここから組む**——`state.presets` を掴んでから
  // `await` を挟むと、先に書けた変更を知らない一覧で上書きする（先の変更が黙って消える）
  const presetsRef = useRef<EnginePreset[]>([]);
  // 読み書きを1本ずつ通す列。**同時に2本書かない**——2本目が1本目の前の印を持って書くと、
  // 自分の変更どうしが `conflict` になる
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  // 列の中で走る処理（`reload` / `deletePreset`）が、組んだ時点ではなく走った時点の選択を読む
  const selectedIdRef = useRef<PresetId | null>(null);
  useEffect(() => {
    selectedIdRef.current = state.selectedPresetId;
  }, [state.selectedPresetId]);

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(job, job);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  /** 書く。書けたら `null`、断られたら理由（列の中からだけ呼ぶ） */
  const write = useCallback(async (presets: EnginePreset[]): Promise<SaveFailure | null> => {
    // 画面の写しで先に断る（出典は Rust の `save_to`。そちらも同じ状態では書かない）
    if (!writableRef.current) {
      return { kind: "readOnly", message: "the presets file is read-only" };
    }
    try {
      revisionRef.current = await savePresets(presets, revisionRef.current);
      return null;
    } catch (e) {
      const failure = asSaveFailure(e);
      console.error("[presets] 保存に失敗した", failure.kind, failure.message);
      return failure;
    }
  }, []);

  /**
   * 変更を1つ通す。`build` は**最後に書けた一覧**から次の一覧を組む（組めなければ `null`）。
   * **書けてから画面に反映する**（悲観更新）——先に変えると、書けなかった変更が画面にだけ残り、
   * 次に開いたときに消える。書けたら次の一覧、書けなかったら `null`
   */
  const mutate = useCallback(
    (build: (current: EnginePreset[]) => EnginePreset[] | null) =>
      enqueue(async (): Promise<EnginePreset[] | null> => {
        const next = build(presetsRef.current);
        if (!next) return null;
        const failure = await write(next);
        if (failure) {
          dispatch({ type: "save_failed", payload: failure });
          return null;
        }
        presetsRef.current = next;
        dispatch({ type: "set_presets", payload: next });
        return next;
      }),
    [enqueue, write],
  );

  /** 読み込みの結果を取り込む。**読み込みの口はここ1つ**（初回と読み直しの両方） */
  const adopt = useCallback(
    (
      loaded: LoadedPresets,
      presets: EnginePreset[],
      selectedPresetId: PresetId | null,
      saveFailure: SaveFailure | null,
    ) => {
      revisionRef.current = loaded.revision;
      writableRef.current = loaded.writable;
      presetsRef.current = presets;
      dispatch({
        type: "loaded",
        payload: {
          presets,
          selectedPresetId,
          writable: loaded.writable,
          unreadableCount: loaded.unreadableCount,
          loadNotice: loaded.loadNotice,
          saveFailure,
        },
      });
    },
    [],
  );

  const runtimeConfig = useMemo<EngineRuntimeConfig | null>(
    () => (selectedPreset ? runtimeConfigOf(selectedPreset) : null),
    [selectedPreset],
  );

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

    void enqueue(async () => {
      dispatch({ type: "loading" });
      try {
        const loaded = await loadPresets();
        revisionRef.current = loaded.revision;
        writableRef.current = loaded.writable;
        let presets = normalizeLoadedPresets(loaded.presets);

        // **書ける状態のときだけ**既定の1件を作る。読めなかったファイルや新しい版のファイルに
        // 書くと、読めていない中身を上書きする。書けなかった理由は取り込みと一緒に渡す
        // （先に `save_failed` を撃つと、直後の `loaded` が消す）
        let saveFailure: SaveFailure | null = null;
        if (presets.length === 0 && loaded.writable) {
          const p = createDefaultPreset();
          saveFailure = await write([p]);
          if (!saveFailure) presets = [p];
        }

        const selectedId = chooseInitialSelectedId(presets);
        adopt(loaded, presets, selectedId, saveFailure);

        if ((config?.last_preset_id ?? null) !== selectedId) {
          await setLastPresetId(selectedId);
        }
      } catch (e) {
        dispatch({
          type: "error",
          payload: `presets の読み込みに失敗しました: ${String(e)}`,
        });
      }
    });
  }, [
    adopt,
    appConfigLoading,
    chooseInitialSelectedId,
    config?.last_preset_id,
    enqueue,
    setLastPresetId,
    write,
  ]);

  const reload = useCallback(
    () =>
      enqueue(async () => {
        dispatch({ type: "loading" });
        try {
          const loaded = await loadPresets();
          const presets = normalizeLoadedPresets(loaded.presets);

          const cur = selectedIdRef.current;
          const stillExists = cur && presets.some((p) => p.id === cur);
          const nextSelected = stillExists ? cur : (presets[0]?.id ?? null);

          adopt(loaded, presets, nextSelected, null);
          await setLastPresetId(nextSelected);
          touchPreset(nextSelected);
        } catch (e) {
          dispatch({
            type: "error",
            payload: `presets の再読み込みに失敗しました: ${String(e)}`,
          });
        }
      }),
    [adopt, enqueue, setLastPresetId, touchPreset],
  );

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
      const next = await mutate((current) => [...current, p]);
      if (!next) return null;
      touchPreset(p.id);
      return p;
    },
    [mutate, touchPreset],
  );

  const duplicatePreset = useCallback(
    async (id: PresetId) => {
      let made: EnginePreset | null = null;
      const next = await mutate((current) => {
        const src = current.find((p) => p.id === id);
        if (!src) return null;
        made = normalizeOnePreset({
          ...clonePreset(src),
          id: genPresetId(),
          label: `${src.label} (copy)`,
        });
        return [...current, made];
      });
      if (!next || !made) return null;
      const copy: EnginePreset = made;
      await selectPreset(copy.id);
      return copy;
    },
    [mutate, selectPreset],
  );

  const updatePreset = useCallback(
    async (id: PresetId, patch: Partial<EnginePreset>) => {
      const next = await mutate((current) =>
        current.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      if (!next) return false;
      touchPreset(id);
      return true;
    },
    [mutate, touchPreset],
  );

  const mergeOptions = useCallback(
    async (id: PresetId, partial: UsiOptionMap) => {
      const next = await mutate((current) =>
        current.map((p) => (p.id === id ? { ...p, options: { ...p.options, ...partial } } : p)),
      );
      return next !== null;
    },
    [mutate],
  );

  const deletePreset = useCallback(
    async (id: PresetId) => {
      const next = await mutate((current) => current.filter((p) => p.id !== id));
      if (!next) return false;

      if (selectedIdRef.current === id) {
        const fallback = next[0]?.id ?? null;
        await selectPreset(fallback);
      }
      return true;
    },
    [mutate, selectPreset],
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

  return <EnginePresetsContext.Provider value={value}>{children}</EnginePresetsContext.Provider>;
}
