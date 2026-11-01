import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import type { EnginePreset } from "@/entities/engine-presets/model/types";
import { probeStatusText, type ProbeFailure } from "@/features/settings/lib/probeStatus";
import {
  keepCurrentEngine,
  presetEngineOptions,
} from "@/features/settings/lib/presetEngineOptions";
import type { AiRootIndexState } from "@/features/settings/model/useAiRootIndex";
import { SField, SSelect } from "@/features/settings/ui/kit";
import Button from "@/shared/ui/Button/Button";
import RescanButton from "./RescanButton";

function isReady({ scan, index }: AiRootIndexState): boolean {
  return scan.status === "ready" && index != null;
}

function placeholderOf(library: AiRootIndexState): string {
  if (!library.hasRoot) return "AI ライブラリが未設定";
  if (library.scan.status === "loading") return "読み込んでいます…";
  if (!isReady(library)) return "エンジンを読み込めませんでした";
  return library.index?.engines.length ? "エンジンを選択" : "engines/ にエンジンがありません";
}

type Props = {
  draft: EnginePreset;
  error: string | undefined;
  library: AiRootIndexState;
  /** 下書きに入れて読み込む */
  onChosen: (enginePath: string) => void;
  /** 読めなかったときに読み込み直す */
  onRetry: () => void;
  onStop: () => void;
  probing: boolean;
  probeFailure: ProbeFailure | null;
};

/** エンジンを選ぶ欄。選んだパスと読み込みの状態を下に出す。 */
export default function EngineField({
  draft,
  error,
  library,
  onChosen,
  onRetry,
  onStop,
  probing,
  probeFailure,
}: Props) {
  const options = keepCurrentEngine(
    presetEngineOptions(library.index?.engines ?? []),
    draft.enginePath,
  );
  const status = probeStatusText(draft, probing, probeFailure);
  // 名乗りは、いまのエンジンを読み込めたときだけ使う
  const engineName = hasCurrentDefinitions(draft) ? draft.engineName : null;

  return (
    <SField
      label="エンジン"
      error={error}
      right={
        library.hasRoot && (
          <RescanButton loading={library.scan.status === "loading"} onClick={library.rescan} />
        )
      }
    >
      <SSelect
        value={draft.enginePath}
        aria-label="エンジン"
        onChange={(e) => onChosen(e.target.value)}
        options={options.map((o) =>
          o.value === draft.enginePath && engineName
            ? { ...o, label: o.note ? `${engineName}（${o.note}）` : engineName }
            : o,
        )}
        placeholder={placeholderOf(library)}
        disabled={!isReady(library) || options.length === 0}
        invalid={!!error}
      />
      {draft.enginePath && <div className="presetDialog__enginePath">{draft.enginePath}</div>}
      {status && (
        <div
          className={status.tone === "warn" ? "presetDialog__hintWarn" : "presetDialog__hintMuted"}
          role={status.tone === "warn" ? "alert" : undefined}
        >
          {status.text}{" "}
          {probing ? (
            <Button size="sm" onClick={onStop}>
              中止
            </Button>
          ) : (
            <Button size="sm" onClick={onRetry}>
              もう一度読み込む
            </Button>
          )}
          {status.detail && <div className="presetDialog__hintMuted">詳細: {status.detail}</div>}
        </div>
      )}
    </SField>
  );
}
