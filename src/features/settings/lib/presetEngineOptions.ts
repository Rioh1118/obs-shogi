import type { EngineCandidate, Launchability } from "@/entities/engine/api/aiLibrary";
import { isEngineForThisMachine } from "@/entities/engine/lib/engineCandidate";
import { isFileKind } from "@/features/settings/lib/fileChoices";
import { getBaseName } from "@/shared/lib/path";

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

type PresetEngineOption = {
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
  return isEngineForThisMachine(candidate) && isFileKind(candidate.kind);
}

/**
 * プリセット編集のエンジンの候補。列挙（`scan_ai_root`）が返したものを**名前で絞らずに**全部並べる。
 * 列挙は engines/ の直下と1段下のフォルダの実行ファイルを見る（`ai_library/engines.rs`）。
 *
 * 評価関数と定跡をどの名前で送るかは申告から決まるので（`engine/binding.rs`）、名前で候補を選ぶ理由は無い
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

/**
 * 候補に無いパス（engines/ の外、消えた）も選択として先頭に足す。
 * 落とすと保存したパスが画面から見えなくなる。
 */
export function keepCurrentEngine(
  options: PresetEngineOption[],
  current: string,
): PresetEngineOption[] {
  const path = current.trim();
  if (!path || options.some((o) => o.value === path)) return options;
  return [
    { value: path, label: `${getBaseName(path)}（現在の選択）`, disabled: false, note: null },
    ...options,
  ];
}
