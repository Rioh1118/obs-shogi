import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset } from "../model/types";

/** 取得に渡すパスと、定義を取ったパス（`definitionsFor`）の比べ方。保存は前後の空白を落とすので揃える */
export function probePathOf(enginePath: string): string {
  return enginePath.trim();
}

/**
 * 下書きの定義が、いま選んでいるエンジンのものか。**定義を読む側は必ずこれを通す**——エンジンを
 * 選び直しても前のエンジンの定義は下書きに残るので、`definitions` の有無だけを見ると別のエンジンの
 * 定義を使う
 */
export function hasCurrentDefinitions(
  preset: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor">,
): boolean {
  return Boolean(preset.definitions) && preset.definitionsFor === probePathOf(preset.enginePath);
}

/**
 * 取得の結果（定義・エンジンの名前・取った時刻）をプリセットの下書きに入れる。**この関数は利用者の
 * 値に触らない**——値を定義に当てるのは `fitValues`（両方を呼ぶのは `presetDialogReducer`）。
 *
 * 取得を撃たずにエンジンのパスが変わっていた（手動のパス欄で打ち換えた）ら、何もせずに同じ参照を
 * 返す。一覧で選び直した回は、新しい取得が撃たれるので古い結果はここへ来る前に捨てられる
 * （呼び手が、いま待っている取得の結果だけを渡す。プリセット編集は `presetDialogReducer`）
 */
export function withDefinitions(
  cur: EnginePreset,
  outcome: ProbeOutcome,
  probedAt: string,
): EnginePreset {
  if (probePathOf(cur.enginePath) !== outcome.enginePath) return cur;
  return {
    ...cur,
    definitions: outcome.definitions,
    definitionsFor: outcome.enginePath,
    probedAt,
    engineName: outcome.name,
    engineAuthor: outcome.author,
  };
}
