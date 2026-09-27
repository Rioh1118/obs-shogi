import type { EngineStartFailureKind } from "@/entities/engine";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

/**
 * 取得に失敗した理由。起動の失敗と同じ種類で届く（Rust の `probe::EngineProber::probe`）。
 * `cancelled` は次の取得に置き換わっただけなので出さない
 */
const PROBE_FAILURE_TEXT: Record<Exclude<EngineStartFailureKind, "cancelled">, string> = {
  spawnFailed: "起動できませんでした。エンジンの場所と、実行の権限があるかを確かめてください",
  quarantined: "macOS がまだ開くのを許可していません",
  notUsi: "USI エンジンとして応答しませんでした",
  exitedEarly: "応答の途中で終了しました",
  timedOut: "応答が上限の時間内に来ませんでした",
  invalidValue: "パスに使えない文字が含まれています",
  other: "取得できませんでした",
  unknown: "取得できませんでした",
};

/**
 * エンジンの欄の下に出す、オプションの定義の状態。
 *
 * 定義は `definitionsFor` が `enginePath` と同じときだけ「取得済み」——エンジンを選び直すと
 * 前のエンジンの定義が下書きに残るので、件数だけを見ると別のエンジンの定義を言う
 */
export function probeStatusText(
  draft: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor" | "engineName">,
  probing: boolean,
  failure: EngineStartFailureKind | null,
): string | null {
  if (!draft.enginePath) return null;
  if (probing) return "オプションを取得中…";
  if (failure && failure !== "cancelled") {
    return `オプションを取得できませんでした: ${PROBE_FAILURE_TEXT[failure]}`;
  }
  if (draft.definitions && draft.definitionsFor === draft.enginePath) {
    const name = draft.engineName ? `（${draft.engineName}）` : "";
    return `オプション ${draft.definitions.length} 件を取得済み${name}`;
  }
  return "オプションは未取得です";
}
