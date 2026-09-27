import type { UsiOptionDef } from "@/entities/engine";
import { fitSpin } from "@/entities/engine-presets/lib/fitValues";

type SpinDef = Extract<UsiOptionDef, { type: "spin" }>;

/**
 * spin の欄に打った文字を、欄を離れたときに確定する値にする。
 *
 * - 空ならエンジン既定（`null`）
 * - 全角数字・桁区切り（`,` `_`）は読み替える（日本語入力のまま打った「１，０２４」）
 * - 範囲の外は丸める（`fitSpin`。送る側と同じ規則）
 * - **確定しないときは `undefined`**: 整数として読めない、または保存済みの値と同じ。確定すると
 *   「利用者が変えた値」として当てる元の値に重なり、別のエンジンに選び直したときに保存済みの値が戻らない
 */
export function commitSpinInput(
  def: SpinDef,
  current: string | null,
  raw: string,
): string | null | undefined {
  const text = raw.normalize("NFKC").replace(/[,_]/g, "").trim();
  if (text === "") return current == null ? undefined : null;
  const fitted = fitSpin(def, text);
  if (fitted == null) return undefined;
  const next = "value" in fitted ? fitted.value : fitted.clampedTo;
  return next === current ? undefined : next;
}
