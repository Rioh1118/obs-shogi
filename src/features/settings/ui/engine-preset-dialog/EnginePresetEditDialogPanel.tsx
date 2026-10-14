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
import PresetDialogFooter from "./PresetDialogFooter";
import UsedFilesSection from "./sections/UsedFilesSection";
import AnalysisSection from "./sections/AnalysisSection";
import EngineSettingsSection from "./sections/EngineSettingsSection";
import { SField, SInput, SSection } from "@/features/settings/ui/kit";
import { useAppConfig } from "@/entities/app-config";
import { bookInUse, type EnginePreset, type PresetId } from "@/entities/engine-presets/model/types";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { multiPvMax } from "@/features/settings/lib/quickOptions";
import { presetEngineOptions } from "@/features/settings/lib/presetEngineOptions";
import { asStartFailure } from "@/entities/engine";
import { probeEngine } from "@/entities/engine/api/tauri";
import { probePathOf, storedDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
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
  const { config } = useAppConfig();

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
        setIndexError(
          `AI のフォルダを読めませんでした。フォルダがあるか（外付けなら繋がっているか）を確かめて「探し直す」を押してください（${String(e)}）`,
        );
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
  /** 開いてから一度でも読み込んだか（開いたときの読み込みを1回にする） */
  const openedProbeRef = useRef(false);
  /**
   * 開いてから空欄の補完を済ませたか。**補完は開いた後の1回だけ**——評価関数の空は「指定しない」という
   * 選択でもあるので、下書きが変わるたびに補完すると、選んだ「指定しない」を既定の評価関数で埋め直す
   */
  const autofilledRef = useRef(false);
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
    openedProbeRef.current = true;
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

  // preset → draft 初期化
  useEffect(() => {
    if (!open) return;
    if (!preset) return;

    dispatch({ type: "opened", preset: deepClone(preset) });
    setErrors({});
  }, [open, preset]);

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

  const scanReady = indexStatus === "ok" && index != null;

  // 候補が揃った時点で1回だけ、**エンジンがまだ無い（作ったばかりの）プリセット**の空欄を埋める。
  // エンジンのあるプリセットの評価関数の空は、利用者が選んだ「指定しない」なので埋めない
  useEffect(() => {
    if (!open) return;
    if (!draft) return;
    if (!index) return;
    if (autofilledRef.current) return;
    autofilledRef.current = true;
    if (cleanText(draft.enginePath)) return;

    setDraft((cur) =>
      cur
        ? autofillPreset(cur, {
            profiles,
            engines,
          })
        : cur,
    );
  }, [open, draft, index, profiles, engines, setDraft]);

  /**
   * 開いたときに1回、エンジンを読み込む（定義と画面の名前はいつも今のエンジン・今の辞書から。画面の名前は
   * 保存しない）。空欄の自動補完でエンジンが埋まった回も、ここで読み込む。利用者が先にエンジンを選んで
   * 読み込んでいれば、もう読まない（`runProbe` が `openedProbeRef` を立てる）
   */
  useEffect(() => {
    if (openedProbeRef.current || !draft?.enginePath) return;
    openedProbeRef.current = true;
    runProbe(draft.enginePath);
  }, [draft?.enginePath, runProbe]);

  /** `null` で値を消す（初期値。送らない） */
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

    // 要るのは名前とエンジンだけ。評価関数は必須にしない（指定できないエンジンがある。流し先は
    // 起動のたびに Rust が決める）
    if (!label) nextErrors.label = "名前を入れてください";
    if (!enginePath) nextErrors.enginePath = "エンジンを選んでください";

    // 「使わない」定跡はパスごと落とす。前の版は使わない定跡のパスを残して保存しているので、
    // 開いて保存し直せば、欄の「使わない」とファイルが揃う
    const bookEnabled = bookInUse(draft);
    const bookFilePath = bookEnabled ? cleanText(draft.bookFilePath ?? "") : null;

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
      definitions: storedDefinitions(draft.definitions),
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
          <SSection title="名前">
            <SField error={errors.label}>
              <SInput
                value={draft.label}
                aria-label="プリセットの名前"
                placeholder="例: 研究用 / 速い解析 / 定跡整備"
                onChange={(e) => {
                  setDraft({ ...draft, label: e.target.value });
                  setErrors((es) => ({ ...es, label: "" }));
                }}
                invalid={!!errors.label}
              />
            </SField>
          </SSection>

          {indexError && <div className="presetDialog__hintWarn">{indexError}</div>}

          <UsedFilesSection
            draft={draft}
            enginePathError={errors.enginePath}
            aiRootReady={Boolean(aiRoot)}
            scanReady={scanReady}
            indexStatus={indexStatus}
            enginesDir={classifyEnginesDir(index?.engines_dir)}
            enginesDirPath={index?.engines_dir?.path ?? ""}
            onCreateEnginesDir={onCreateEnginesDir}
            rescan={rescan}
            engineOptions={engineOptions}
            profiles={profiles}
            onEngineChosen={(path) => {
              // 名乗りは読み込めたエンジンのもの。残すと、読み込めなかった別のエンジンを前の名乗りで出す
              setDraft({ ...draft, enginePath: path, engineName: null, engineAuthor: null });
              setErrors((es) => ({ ...es, enginePath: "" }));
              runProbe(path);
            }}
            onEvalChosen={(path, folder) =>
              setDraft({
                ...draft,
                evalFilePath: path,
                // ライブラリから選べばそのフォルダ。「指定しない」なら空（`EnginePreset.aiName`）
                aiName: path === "" ? "" : (folder ?? draft.aiName),
              })
            }
            onBookChosen={(path) =>
              setDraft({ ...draft, bookEnabled: path != null, bookFilePath: path })
            }
            onRetry={() => runProbe(draft.enginePath)}
            onStop={stopProbe}
            probing={probing}
            probeFailure={probeFailure}
          />

          <AnalysisSection
            draft={draft}
            setDraft={setDraft}
            setOpt={setOpt}
            multiPvMax={multiPvMax(draft)}
          />

          <EngineSettingsSection
            draft={draft}
            setOpt={setOpt}
            clearOptions={clearOptions}
            probing={probing}
            fitNote={fitNote}
          />
        </div>

        <PresetDialogFooter onClose={onClose} onSave={onSave} saveDisabled={probing} />
      </div>
    </Modal>
  );
}
