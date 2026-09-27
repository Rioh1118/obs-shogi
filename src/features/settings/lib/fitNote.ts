import type {
  ClampedValue,
  DroppedValue,
  FittedValues,
} from "@/entities/engine-presets/lib/fitValues";
import { probePathOf } from "@/entities/engine-presets/lib/withDefinitions";

/** 取得した定義に当てて変えた値と、どのエンジンの定義で当てたか */
export type FitNote = Pick<FittedValues, "clamped" | "dropped"> & { enginePath: string };

const DROP_REASON: Record<DroppedValue["reason"], string> = {
  notDeclared: "このエンジンに無い",
  overriddenByBinding: "アプリが決める値。評価関数・定跡の欄か、解析の方針で決まる",
  notInVars: "選択肢に無い",
  invalidType: "型が合わない",
  button: "値を持たない",
};

function rangeOf(c: ClampedValue): string {
  return `${c.min ?? ""}〜${c.max ?? ""}`;
}

/**
 * 画面に出す行（1件1行）。当てたエンジンがいまのエンジンでなければ出さない——選び直した後に
 * 前のエンジンで外した値を言わない
 */
export function fitNoteLines(note: FitNote | null, enginePath: string): string[] {
  if (!note || note.enginePath !== probePathOf(enginePath)) return [];
  return [
    ...note.dropped.map((d) => `${d.name} = ${d.value} を外しました（${DROP_REASON[d.reason]}）`),
    ...note.clamped.map(
      (c) =>
        `${c.name} を ${c.from} から ${c.value} に丸めました（このエンジンの範囲は ${rangeOf(c)}）`,
    ),
  ];
}
