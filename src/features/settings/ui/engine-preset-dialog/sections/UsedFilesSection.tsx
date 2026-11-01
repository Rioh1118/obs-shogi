import { bookInUse, type EnginePreset } from "@/entities/engine-presets/model/types";
import { bookChoices, evalChoices } from "@/features/settings/lib/fileChoices";
import type { ProbeFailure } from "@/features/settings/lib/probeStatus";
import type { AiRootIndexState } from "@/features/settings/model/useAiRootIndex";
import { SField, SSection, SSelect } from "@/features/settings/ui/kit";
import EngineField from "./EngineField";
import EnginesDirBand from "./EnginesDirBand";

type Props = {
  draft: EnginePreset;
  enginePathError: string | undefined;
  library: AiRootIndexState;
  onEngineChosen: (enginePath: string) => void;
  /** `folder` はライブラリから選んだときのフォルダ。「指定しない」と現在の選択は `null` */
  onEvalChosen: (path: string, folder: string | null) => void;
  /** `null` は「使わない」 */
  onBookChosen: (path: string | null) => void;
  onRetry: () => void;
  onStop: () => void;
  probing: boolean;
  probeFailure: ProbeFailure | null;
};

/** 「使うもの」の節。エンジン、評価関数、定跡を選ぶ。 */
export default function UsedFilesSection({
  draft,
  enginePathError,
  library,
  onEngineChosen,
  onEvalChosen,
  onBookChosen,
  onRetry,
  onStop,
  probing,
  probeFailure,
}: Props) {
  const profiles = library.index?.profiles ?? [];
  const evals = evalChoices(profiles, draft.evalFilePath);
  const bookUsed = bookInUse(draft);
  const books = bookChoices(profiles, bookUsed ? draft.bookFilePath : null);

  return (
    <SSection title="使うもの">
      {!library.hasRoot && (
        <div className="presetDialog__hintWarn">
          AI ライブラリが決まっていません。設定の「AI
          ライブラリ」で選ぶと、ここにエンジンと評価関数が並びます。
        </div>
      )}
      <EnginesDirBand library={library} />

      <div className="presetDialog__stack">
        <EngineField
          draft={draft}
          error={enginePathError}
          library={library}
          onChosen={onEngineChosen}
          onRetry={onRetry}
          onStop={onStop}
          probing={probing}
          probeFailure={probeFailure}
        />

        <SField label="評価関数">
          <SSelect
            value={draft.evalFilePath}
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
