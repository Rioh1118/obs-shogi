import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { classifyEnginesDir } from "@/entities/engine/lib/enginesDir";
import "./EnginePresetEditDialogPanel.scss";

import Modal from "@/shared/ui/Modal";

import {
  autofillPreset,
  basename,
  clampInt,
  cleanText,
  deepClone,
  parseIntSafe,
} from "@/features/settings/lib/presetDialog";
import BasicSection from "./sections/BasicSection";
import EngineFilesSection from "./sections/EngineFilesSection";
import ImportantOptionsSection from "./sections/ImportantOptionsSection";
import UsiOptionsSection from "./sections/UsiOptionsSection";
import AnalysisDefaultsSection from "./sections/AnalysisDefaultsSection";
import PresetDialogFooter from "./PresetDialogFooter";
import { useAppConfig } from "@/entities/app-config";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { multiPvMax } from "@/features/settings/lib/quickOptions";
import { presetEngineOptions } from "@/features/settings/lib/presetEngineOptions";
import { asStartFailure } from "@/entities/engine";
import { probeEngine } from "@/entities/engine/api/tauri";
import { probePathOf } from "@/entities/engine-presets/lib/withDefinitions";
import {
  initialPresetDialogState,
  presetDialogReducer,
} from "@/features/settings/model/presetDialogReducer";
import PresetDialogHeader from "./PresetDialogHeader";
import { ensureEnginesDir, scanAiRoot, type AiRootIndex } from "@/entities/engine/api/aiLibrary";

type Props = {
  presetId: PresetId;
  open: boolean;
  onClose: () => void;
};

/** Hookなしラッパー：Hookルール的に safe */
export default function EnginePresetEditDialogPanel(props: Props) {
  if (!props.open) return null;
  return <EnginePresetEditDialogInner {...props} />;
}

/** ここから Hook を使う本体 */
function EnginePresetEditDialogInner({ presetId, open, onClose }: Props) {
  const { state, updatePreset } = useEnginePresets();
  const { config, chooseAiRoot } = useAppConfig();

  const preset = useMemo(
    () => state.presets.find((p) => p.id === presetId) ?? null,
    [state.presets, presetId],
  );

  const aiRoot = config?.ai_root ?? null;

  // ---- scan state ----
  /**
   * 読めた索引と、**それがどのルートのものか**。
   *
   * ルートを持たせないと、切り替えた直後の走査中に前のルートの索引で描くことになる——
   * 帯が旧ルートの絶対パスを名指しし、その隣の「engines/ を作成」は新しいルートに対して
   * 働く（本文と動作の宛先が食い違う）。候補の一覧も前のルートのものが残る。
   * 同じ形を `AiLibraryTab` が `LoadedIndex` で持っている
   */
  const [loaded, setLoaded] = useState<{ root: string; index: AiRootIndex } | null>(null);
  const [indexStatus, setIndexStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);

  const rescan = useCallback(() => setScanNonce((n) => n + 1), []);

  /**
   * いま指しているルート。**`await` を跨いだ後の書き込みを関門するために要る。**
   *
   * 書くのはルートが変わる場所＝この effect（`aiRoot` は設定からしか変わらない）。
   * 読むのは `await` の後だけ——それが関門の定義。
   * 同じ役の ref を `AiLibraryTab` が `currentRootRef` として持っている
   */
  const currentRootRef = useRef(aiRoot);

  useEffect(() => {
    let cancelled = false;
    currentRootRef.current = aiRoot;

    (async () => {
      if (!open) return;
      if (!aiRoot) {
        setLoaded(null);
        setIndexStatus("idle");
        setIndexError(null);
        return;
      }

      setIndexStatus("loading");
      setIndexError(null);
      try {
        const idx = await scanAiRoot(aiRoot);
        if (cancelled) return;
        setLoaded({ root: aiRoot, index: idx });
        setIndexStatus("ok");
      } catch (e) {
        if (cancelled) return;
        setLoaded(null);
        setIndexStatus("error");
        setIndexError(`AI_ROOT のスキャンに失敗しました: ${String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, aiRoot, scanNonce]);

  // preset が消えたら閉じる
  useEffect(() => {
    if (!open) return;
    if (!preset) onClose();
  }, [open, preset, onClose]);

  // ---- derived candidates ----
  // **別のルートの索引は使わない。** 読み直しの最中は同じルートの索引を残すが、
  // 切り替えた直後は「まだ何も読めていない」が正しい
  const index = loaded && loaded.root === aiRoot ? loaded.index : null;

  const engines = useMemo(() => index?.engines ?? [], [index?.engines]);
  const profiles = useMemo(() => index?.profiles ?? [], [index?.profiles]);

  // ---- draft と取得（`presetDialogReducer`） ----
  const [dialog, dispatch] = useReducer(presetDialogReducer, initialPresetDialogState);
  const { draft, probeFailure, fitNote } = dialog;
  const probing = dialog.probe !== null;
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** 各節が下書きを直す口（値以外の欄）。reducer の `edited` に渡す */
  const setDraft = useCallback(
    (update: SetStateAction<EnginePreset | null>) => dispatch({ type: "edited", update }),
    [],
  );

  /**
   * `enginePath` の申告を取る。結果を使うかは reducer が決める（いま待っている取得の結果だけ。
   * 取得を撃たずにパスだけが変わっていたら当てない）
   */
  const runProbe = useCallback((rawPath: string) => {
    const enginePath = probePathOf(rawPath);
    if (!enginePath) return;
    const { token, outcome } = probeEngine(enginePath);
    dispatch({ type: "probeStarted", token, enginePath });
    outcome.then(
      (result) =>
        dispatch({
          type: "probeSucceeded",
          token,
          outcome: result,
          probedAt: new Date().toISOString(),
        }),
      (e: unknown) => {
        const failure = asStartFailure(e);
        console.warn("[EnginePresetEditDialog] probe failed:", failure.message);
        dispatch({
          type: "probeFailed",
          token,
          failure: { kind: failure.kind, message: failure.message },
        });
      },
    );
  }, []);

  /** 待ちをやめ、保存できるようにする。待っていた取得の結果は来ても捨てる */
  const stopProbe = useCallback(() => dispatch({ type: "probeAbandoned" }), []);

  // ---- CPU recommended ----
  const cores = useMemo(() => {
    const c =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    return clampInt(c, 1, 128);
  }, []);

  const recommendedThreads = useMemo(() => clampInt(Math.min(cores, 8), 1, cores), [cores]);

  // preset → draft 初期化
  useEffect(() => {
    if (!open) return;
    if (!preset) return;

    dispatch({ type: "opened", preset: deepClone(preset) });
    setErrors({});
  }, [open, preset]);

  const currentProfile = useMemo(() => {
    const name = cleanText(draft?.aiName ?? "");
    if (!name) return null;
    return profiles.find((p) => p.name === name) ?? null;
  }, [profiles, draft?.aiName]);

  const evalFiles = useMemo(() => {
    const xs = currentProfile?.eval_files ?? [];
    const nn = xs.filter((f) => f.entry === "nn.bin");
    const rest = xs.filter((f) => f.entry !== "nn.bin");
    return [...nn, ...rest];
  }, [currentProfile]);

  const bookDbs = useMemo(() => currentProfile?.book_db_files ?? [], [currentProfile]);

  const engineOptions = useMemo(() => {
    const opts = presetEngineOptions(engines);

    // 候補に無いパス（手で入れた、engines/ の外、消えた）も選択として残す。
    // 落とすと select が空になり、保存したパスが画面から見えなくなる
    const cur = cleanText(draft?.enginePath ?? "");
    if (cur && !opts.some((o) => o.value === cur)) {
      opts.unshift({
        value: cur,
        label: `${basename(cur)}（現在の選択）`,
        disabled: false,
        note: null,
      });
    }

    return opts;
  }, [engines, draft?.enginePath]);

  const evalOptions = useMemo(
    () =>
      evalFiles.map((f) => ({
        value: f.path,
        label: f.entry,
        disabled: !(f.kind === "file" || f.kind === "symlink"),
      })),
    [evalFiles],
  );

  const bookOptions = useMemo(
    () =>
      bookDbs.map((f) => ({
        value: f.path,
        label: f.entry,
        disabled: !(f.kind === "file" || f.kind === "symlink"),
      })),
    [bookDbs],
  );

  const threadChoices = useMemo(() => {
    const base = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128];
    const xs = base.filter((n) => n <= cores);
    if (!xs.includes(cores)) xs.push(cores);
    xs.sort((a, b) => a - b);
    return xs;
  }, [cores]);

  const scanReady = indexStatus === "ok" && index != null;

  // ---- index available → “空欄だけ” 最小オートフィル ----
  useEffect(() => {
    if (!open) return;
    if (!draft) return;
    if (!index) return;

    setDraft((cur) =>
      cur
        ? autofillPreset(cur, {
            profiles,
            engines,
          })
        : cur,
    );
  }, [open, draft, index, profiles, engines, setDraft]);

  /** `null` で値を消す（エンジン既定。送らない） */
  const setOpt = useCallback(
    (name: string, value: string | null) => dispatch({ type: "optionSet", name, value }),
    [],
  );
  const clearOptions = useCallback(
    (names: string[]) => dispatch({ type: "optionsCleared", names }),
    [],
  );

  const onCreateEnginesDir = useCallback(async () => {
    const root = aiRoot;
    if (!root) return;
    try {
      setIndexStatus("loading");
      await ensureEnginesDir(root);

      // 切り替え後の走査と重ねて、同じルートをもう一度歩かせない
      // （`rescan` はそのときの `aiRoot` を読むので、古いルートを走ることは無い）
      if (root !== currentRootRef.current) return;
      rescan();
    } catch (e) {
      // **前のルートの失敗を新しいルートの画面へ書かない。** 書くと、指してもいない
      // フォルダの失敗が赤字で出たうえ、`indexStatus` が error に落ちて
      // 読めている索引ごと候補が塞がる
      if (root !== currentRootRef.current) return;
      setIndexStatus("error");
      setIndexError(`engines/ の作成に失敗しました: ${String(e)}`);
    }
  }, [aiRoot, rescan]);

  const onSave = useCallback(async () => {
    if (!draft) return;
    // 取得中に保存すると、取得が返る前のエンジンの定義（または無し）で書く
    if (probing) return;

    const nextErrors: Record<string, string> = {};

    const label = cleanText(draft.label);
    const aiName = cleanText(draft.aiName);
    const enginePath = cleanText(draft.enginePath);
    const evalFilePath = cleanText(draft.evalFilePath);

    if (!label) nextErrors.label = "名前は必須です";
    if (!aiName) nextErrors.aiName = "AI名（プロファイル）を選択してください";
    if (!enginePath) nextErrors.enginePath = "エンジンを選択してください";
    // 評価関数は必須にしない（指定できないエンジンがある。流し先は起動のたびに Rust が決める）

    const bookEnabled = Boolean(draft.bookEnabled);
    // 解析で使わなくても定跡のパスは残す（定跡ビューが出す）
    const bookFilePath = cleanText(draft.bookFilePath ?? "") || null;
    if (bookEnabled && !bookFilePath) nextErrors.bookFilePath = "定跡ファイルを選択してください";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // analysis: <=0 は落とす（軽く）
    const a = draft.analysis ?? { mateSearch: false };
    const timeSeconds =
      a.timeSeconds != null ? clampInt(parseIntSafe(a.timeSeconds, 0), 0, 3600) : undefined;
    const depth = a.depth != null ? clampInt(parseIntSafe(a.depth, 0), 0, 999) : undefined;
    const nodes = a.nodes != null ? clampInt(parseIntSafe(a.nodes, 0), 0, 999_999_999) : undefined;

    const analysis =
      (timeSeconds && timeSeconds > 0) ||
      (depth && depth > 0) ||
      (nodes && nodes > 0) ||
      a.mateSearch
        ? {
            timeSeconds: timeSeconds && timeSeconds > 0 ? timeSeconds : undefined,
            depth: depth && depth > 0 ? depth : undefined,
            nodes: nodes && nodes > 0 ? nodes : undefined,
            mateSearch: Boolean(a.mateSearch),
          }
        : undefined;

    // options: 空は入れない。値は下書きのとおり（無い名前はエンジン既定で、送らない）
    const rawOpt = draft.options ?? {};
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawOpt)) {
      const vv = cleanText(String(v ?? ""));
      if (!vv) continue;
      options[k] = vv;
    }

    const patch: Partial<EnginePreset> = {
      label,
      aiName,
      enginePath,
      evalFilePath,
      bookEnabled,
      bookFilePath,
      options,
      analysis,
      definitions: draft.definitions ?? null,
      reservedNames: draft.reservedNames ?? null,
      definitionsFor: draft.definitionsFor ?? null,
      probedAt: draft.probedAt ?? null,
      engineName: draft.engineName ?? null,
      engineAuthor: draft.engineAuthor ?? null,
    };

    // 書けなかったら閉じない（入力を残す）。理由は帯が出す（`PresetsFileBridge`）
    if (await updatePreset(presetId, patch)) onClose();
  }, [draft, onClose, presetId, probing, updatePreset]);

  if (!preset || !draft) return null;

  const title = cleanText(draft.label) || "プリセット編集";

  return (
    <Modal
      onClose={onClose}
      label={title}
      theme="dark"
      size="lg"
      variant="dialog"
      chrome="card"
      scroll="none"
      closeOnEsc={true}
      closeOnOverlay={true}
      showCloseButton={true}
    >
      <div className="presetDialog">
        <PresetDialogHeader title={title} />

        <div className="presetDialog__body">
          <BasicSection
            draft={draft}
            setDraft={setDraft}
            errors={errors}
            setErrors={setErrors}
            aiRoot={aiRoot}
            chooseAiRoot={() => {
              // **同じルートを選び直した回は自分で走査する。** `chooseAiRoot` は設定を
              // 書き換えてから返るが、同じ値なら `aiRoot` が動かないので effect は再走しない
              // ——効かなくなった外付けを繋ぎ直した人が、唯一押せる口を押しても
              // 画面が1ピクセルも変わらないことになる。判定の材料は `await` の前に取る
              // （`currentRootRef` は effect も書くので、返った後に読むと競る）
              const before = currentRootRef.current;

              void chooseAiRoot({ force: true }).then((picked) => {
                // 失敗を捨てると、押しても何も起きない画面になる
                if (!picked.success) {
                  setErrors((prev) => ({ ...prev, aiName: picked.error }));
                  return;
                }
                if (picked.data !== null && picked.data === before) rescan();
              });
            }}
            rescan={rescan}
            indexStatus={indexStatus}
            indexError={indexError}
            scanReady={scanReady}
            profiles={profiles}
            currentProfile={currentProfile}
          />

          <EngineFilesSection
            probing={probing}
            probeFailure={probeFailure}
            onProbe={runProbe}
            onStopProbe={stopProbe}
            fitNote={fitNote}
            draft={draft}
            setDraft={setDraft}
            errors={errors}
            setErrors={setErrors}
            aiRootReady={Boolean(aiRoot)}
            scanReady={scanReady}
            indexStatus={indexStatus}
            enginesDir={classifyEnginesDir(index?.engines_dir)}
            enginesDirPath={index?.engines_dir?.path ?? ""}
            onCreateEnginesDir={onCreateEnginesDir}
            rescan={rescan}
            engineOptions={engineOptions}
            currentProfile={currentProfile}
            evalOptions={evalOptions}
            bookOptions={bookOptions}
            evalFilesCount={evalFiles.length}
            bookDbsCount={bookDbs.length}
            profiles={profiles}
          />

          <ImportantOptionsSection
            draft={draft}
            setOpt={setOpt}
            cores={cores}
            recommendedThreads={recommendedThreads}
            threadChoices={threadChoices}
            multiPvMax={multiPvMax(draft)}
          />

          <UsiOptionsSection draft={draft} setOpt={setOpt} clearOptions={clearOptions} />

          <AnalysisDefaultsSection draft={draft} setDraft={setDraft} />
        </div>

        <PresetDialogFooter onClose={onClose} onSave={onSave} saveDisabled={probing} />
      </div>
    </Modal>
  );
}
