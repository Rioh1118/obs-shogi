import type { ProbeOutcome, UsiOptionDef } from "@/entities/engine";
import type { EnginePreset } from "../model/types";

/**
 * プリセットに残す形の定義。画面の名前と分類（`label`、`group`）を外す。表示のためにだけ取得の結果に
 * 載るもので、保存すると辞書（Rust の `option_labels`）を直しても既存のプリセットに届かない
 */
export function storedDefinitions(defs: UsiOptionDef[] | null | undefined): UsiOptionDef[] | null {
  if (!defs) return null;
  return defs.map((d) => {
    const { label: _label, group: _group, ...stored } = d;
    return stored as UsiOptionDef;
  });
}

/** 取得に渡すパスと、定義を取ったパス（`definitionsFor`）の比べ方。保存は前後の空白を落とすので揃える */
export function probePathOf(enginePath: string): string {
  return enginePath.trim();
}

/**
 * 下書きの定義が、いま選んでいるエンジンのものか。**定義を読む側は必ずこれを通す。** エンジンを
 * 選び直しても前のエンジンの定義は下書きに残るので、`definitions` の有無だけを見ると別のエンジンの
 * 定義を使う。
 *
 * アプリが決める名前（`reservedNames`）が無い定義も「いまの定義」と扱わない。それを持たずに保存された
 * 定義では、評価関数と定跡の欄が持つ名前の欄が編集できるように見え、入れた値は起動のたびに捨てられる。
 * 取り直せば揃う
 */
export function hasCurrentDefinitions(
  preset: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor" | "reservedNames">,
): boolean {
  return (
    Boolean(preset.definitions) &&
    preset.reservedNames != null &&
    preset.definitionsFor === probePathOf(preset.enginePath)
  );
}

/**
 * 取得の結果（定義、エンジンの名前、取った時刻）をプリセットの下書きに入れる。利用者の値には
 * 触らない。値を定義に当てるのは `fitValues`（両方を呼ぶのは `presetDialogReducer`）。
 *
 * 取得を始めずにエンジンのパスが変わっていた（手動のパス欄で打ち換えた）ら、何もせずに同じ参照を
 * 返す。一覧で選び直したときは新しい取得が始まるので、古い結果はここへ来る前に捨てられる
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
    reservedNames: outcome.reserved,
    definitionsFor: outcome.enginePath,
    probedAt,
    engineName: outcome.name,
    engineAuthor: outcome.author,
  };
}
