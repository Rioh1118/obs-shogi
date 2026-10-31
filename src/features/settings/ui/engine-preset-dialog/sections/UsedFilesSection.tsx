import Button from "@/shared/ui/Button/Button";
import { SField, SSection, SSelect } from "@/features/settings/ui/kit";
import { canCreateEnginesDir, type EnginesDir } from "@/entities/engine/lib/enginesDir";
import type { ProfileCandidate } from "@/entities/engine/api/aiLibrary";
import { bookInUse, type EnginePreset } from "@/entities/engine-presets/model/types";
import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import type { PresetEngineOption } from "@/features/settings/lib/presetEngineOptions";
import { bookChoices, evalChoices } from "@/features/settings/lib/fileChoices";
import { probeStatusText, type ProbeFailure } from "@/features/settings/lib/probeStatus";

/**
 * engines/ の帯の文言。網羅の理由は `EnginesDir` の doc。
 * `null` は帯を出さない（読めていない `unknown` に「存在しません」と言わない）
 */
const ENGINES_DIR_HINT: Record<EnginesDir, ((path: string) => string) | null> = {
  unknown: null,
  dir: null,
  missing: (path) => `engines/ フォルダがありません（${path}）。`,
  other: (path) => `engines がフォルダではありません（${path}）。同じ名前のものを削除してください。`,
};

/**
 * AI ライブラリを読み直すボタンの読み上げ名。**エンジンの読み込みの「もう一度読み込む」が同じ欄に
 * 並ぶ**ので、見える語は同じでも読み上げでは何を読み直すかを名指す
 */
const RESCAN_NAME = "AI ライブラリをもう一度読み込む";

/**
 * 何を使うか: エンジン・評価関数・定跡。評価関数と定跡は、AI ライブラリの全部のフォルダから
 * 「フォルダ / ファイル」で1つ選ぶ（`evalChoices` / `bookChoices`）。
 *
 * エンジンを選ぶと裏で読み込む（呼び手の `onEngineChosen`）。欄の下に出すのは読み込み中と、
 * 読めなかったときだけ（`probeStatusText`）
 */
export default function UsedFilesSection(props: {
  draft: EnginePreset;
  enginePathError: string | undefined;
  aiRootReady: boolean;
  scanReady: boolean;
  indexStatus: "idle" | "loading" | "ok" | "error";
  /** `engines` が何として在るか（`classifyEnginesDir`） */
  enginesDir: EnginesDir;
  enginesDirPath: string;
  onCreateEnginesDir: () => void;
  rescan: () => void;
  engineOptions: PresetEngineOption[];
  profiles: ProfileCandidate[];
  /** エンジンを選んだ（下書きに入れて読み込む） */
  onEngineChosen: (enginePath: string) => void;
  /** 評価関数を選んだ。`folder` はライブラリから選んだときのフォルダ（「指定しない」・現在の選択は `null`） */
  onEvalChosen: (path: string, folder: string | null) => void;
  /** 定跡を選んだ。`null` は「使わない」 */
  onBookChosen: (path: string | null) => void;
  /** 読めなかったときに読み込み直す */
  onRetry: () => void;
  onStop: () => void;
  probing: boolean;
  probeFailure: ProbeFailure | null;
}) {
  const {
    draft,
    enginePathError,
    aiRootReady,
    scanReady,
    indexStatus,
    enginesDir,
    enginesDirPath,
    onCreateEnginesDir,
    rescan,
    engineOptions,
    profiles,
    onEngineChosen,
    onEvalChosen,
    onBookChosen,
    onRetry,
    onStop,
    probing,
    probeFailure,
  } = props;

  const band = ENGINES_DIR_HINT[enginesDir];
  const status = probeStatusText(draft, probing, probeFailure);
  const evals = evalChoices(profiles, draft.evalFilePath);
  const bookUsed = bookInUse(draft);
  const books = bookChoices(profiles, bookUsed ? draft.bookFilePath : null);
  // 名乗り（id name）は、いまのエンジンを読み込めたときだけ使う
  const engineName = hasCurrentDefinitions(draft) ? draft.engineName : null;

  return (
    <SSection title="使うもの">
      {!aiRootReady && (
        <div className="presetDialog__hintWarn">
          AI ライブラリが決まっていません。設定の「AI
          ライブラリ」で選ぶと、ここにエンジンと評価関数が並びます。
        </div>
      )}
      {band && (
        <div className="presetDialog__hintWarn">
          {band(enginesDirPath)}
          <div className="presetDialog__inputRow presetDialog__bandActions">
            {/* 読み直している間は押せなくする（帯の文言は前の索引のままなので、押せると効かなかったと読まれる） */}
            {canCreateEnginesDir(enginesDir) && (
              <Button
                tone="primary"
                size="sm"
                onClick={onCreateEnginesDir}
                disabled={indexStatus === "loading"}
              >
                engines/ を作成
              </Button>
            )}
            <Button
              size="sm"
              onClick={rescan}
              busy={indexStatus === "loading"}
              aria-label={RESCAN_NAME}
            >
              もう一度読み込む
            </Button>
          </div>
        </div>
      )}

      <div className="presetDialog__stack">
        <SField
          label="エンジン"
          error={enginePathError}
          right={
            // **いつも押せる。** 探すのが返らない（応答しないドライブ）ときと、開いたままエンジンを
            // 置いたときに、閉じずに探し直す口が要る
            aiRootReady && (
              <Button
                size="sm"
                onClick={rescan}
                busy={indexStatus === "loading"}
                aria-label={RESCAN_NAME}
              >
                もう一度読み込む
              </Button>
            )
          }
        >
          <SSelect
            value={draft.enginePath ?? ""}
            aria-label="エンジン"
            onChange={(e) => onEngineChosen(e.target.value)}
            options={engineOptions.map((o) =>
              // 読み込めたエンジンは名乗りで出す。起動できない見込みの理由は名乗りの後ろにも添える
              o.value === draft.enginePath && engineName
                ? { ...o, label: o.note ? `${engineName}（${o.note}）` : engineName }
                : o,
            )}
            placeholder={
              !aiRootReady
                ? "AI ライブラリが未設定"
                : !scanReady
                  ? indexStatus === "loading"
                    ? "読み込んでいます…"
                    : "エンジンを読み込めませんでした"
                  : engineOptions.length > 0
                    ? "エンジンを選択"
                    : "engines/ にエンジンがありません"
            }
            disabled={!aiRootReady || !scanReady || engineOptions.length === 0}
            invalid={!!enginePathError}
          />
          {draft.enginePath && <div className="presetDialog__enginePath">{draft.enginePath}</div>}
          {status && (
            <div
              className={
                status.tone === "warn" ? "presetDialog__hintWarn" : "presetDialog__hintMuted"
              }
              role={status.tone === "warn" ? "alert" : undefined}
            >
              {status.text}{" "}
              {probing ? (
                <Button size="sm" onClick={onStop}>
                  中止する
                </Button>
              ) : (
                <Button size="sm" onClick={onRetry}>
                  もう一度読み込む
                </Button>
              )}
              {status.detail && (
                <div className="presetDialog__hintMuted">詳細: {status.detail}</div>
              )}
            </div>
          )}
        </SField>

        <SField label="評価関数">
          <SSelect
            value={draft.evalFilePath ?? ""}
            aria-label="評価関数"
            onChange={(e) =>
              onEvalChosen(
                e.target.value,
                evals.find((c) => c.value === e.target.value)?.folder ?? null,
              )
            }
            options={evals}
          />
        </SField>

        <SField label="定跡" description="選んだ定跡を検討で使い、定跡ビューにも出します。">
          <SSelect
            value={bookUsed ? (draft.bookFilePath ?? "") : ""}
            aria-label="定跡"
            onChange={(e) => onBookChosen(e.target.value === "" ? null : e.target.value)}
            options={books}
          />
        </SField>
      </div>
    </SSection>
  );
}
