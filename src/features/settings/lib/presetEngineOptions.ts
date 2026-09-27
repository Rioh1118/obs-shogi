import type { EngineCandidate, Launchability } from "@/entities/engine/api/aiLibrary";
import { isEngineForThisMachine } from "@/entities/engine/lib/engineCandidate";

/**
 * 起動できない見込みの理由。`ready` は何も添えない。
 *
 * 名前の後ろに添えて**候補から外さない。** 外すと、置いたのに出ないエンジンについて
 * 画面が何も言わない。AI ライブラリタブは `isEngineForThisMachine` で数えるので、
 * 別の OS 向けと読めないものは向こうには理由ごと出ない
 */
const LAUNCHABILITY_NOTE: Record<Launchability, string | null> = {
  ready: null,
  notExecutable: "実行権限がありません",
  quarantined: "macOS がまだ開くのを許可していません",
  unreadable: "読めません",
  wrongPlatform: "別の OS 向けです",
};

export type PresetEngineOption = {
  value: string;
  label: string;
  disabled: boolean;
  /** 起動できない見込みの理由。無ければ `null` */
  note: string | null;
};

/**
 * プリセット編集で選べるか。このマシン向けで（`isEngineForThisMachine`。何を数えるかの理由は
 * そちらの doc）、ファイルであること
 */
export function isSelectableEngine(candidate: EngineCandidate): boolean {
  return (
    isEngineForThisMachine(candidate) && (candidate.kind === "file" || candidate.kind === "symlink")
  );
}

/**
 * プリセット編集のエンジンの候補。列挙（`scan_ai_root`）が返したものを**名前で絞らずに**全部並べる。
 * 列挙は engines/ の直下と1段下のフォルダの実行ファイルを見る（`ai_library/engines.rs`）。
 *
 * 評価関数・定跡をどの名前で送るかは実行ファイル名でなくエンジンの申告から決まるので
 * （`engine/binding.rs`）、名前で候補を選ぶ理由は無い
 */
export function presetEngineOptions(engines: EngineCandidate[]): PresetEngineOption[] {
  return engines.map((e) => {
    const note = LAUNCHABILITY_NOTE[e.launchability];
    return {
      value: e.path,
      label: note ? `${e.entry}（${note}）` : e.entry,
      disabled: !isSelectableEngine(e),
      note,
    };
  });
}
