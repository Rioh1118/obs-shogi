import type { UsiOptionDef } from "@/entities/engine";
import type { UsiOptionMap } from "../model/types";

/** 定義に当てて外した利用者の値1件と、その理由 */
export type DroppedValue = {
  name: string;
  value: string;
  reason: "notDeclared" | "reserved" | "notInVars" | "invalidType" | "button";
};

export type FittedValues = {
  options: UsiOptionMap;
  /** 範囲の外にあって丸めた値（丸めた後の値） */
  clamped: Array<{ name: string; value: string }>;
  dropped: DroppedValue[];
};

type Fit = { value: string } | { clampedTo: string } | { dropped: DroppedValue["reason"] };

/**
 * 値1件を定義に当てる。**送る側（Rust の `binding::user_value`）と同じ規則**にする——画面で残した値が
 * 起動のたびに捨てられる・丸められる、を作らない
 */
function fit(def: UsiOptionDef, value: string): Fit {
  switch (def.type) {
    case "check": {
      const v = value.toLowerCase();
      return v === "true" || v === "false" ? { value: v } : { dropped: "invalidType" };
    }
    case "spin": {
      if (!/^\s*[+-]?\d+\s*$/.test(value)) return { dropped: "invalidType" };
      const n = Number.parseInt(value, 10);
      const lo = def.min ?? Number.NEGATIVE_INFINITY;
      const hi = def.max ?? Number.POSITIVE_INFINITY;
      const clamped = Math.min(Math.max(n, Math.min(lo, hi)), Math.max(lo, hi));
      return clamped === n ? { value: String(n) } : { clampedTo: String(clamped) };
    }
    case "combo":
      return def.vars.includes(value) ? { value } : { dropped: "notInVars" };
    case "button":
      return { dropped: "button" };
    case "string":
    case "filename":
      return { value };
  }
}

/**
 * 利用者の値を、エンジンの定義に当てる。定義に無い名前・評価関数や定跡の欄が持つ名前（`reserved`）・
 * 選択肢に無い値・型の合わない値は外し、範囲の外は丸める。
 *
 * 外した値・丸めた値は黙って消さずに返す（画面が保存の前に見せる）
 */
export function fitValues(
  options: UsiOptionMap,
  definitions: UsiOptionDef[],
  reserved: string[],
): FittedValues {
  const defs = new Map(definitions.map((d) => [d.name, d]));
  const owned = new Set(reserved);
  const next: UsiOptionMap = {};
  const clamped: FittedValues["clamped"] = [];
  const dropped: DroppedValue[] = [];

  for (const [name, value] of Object.entries(options)) {
    const def = defs.get(name);
    if (!def) {
      dropped.push({ name, value, reason: "notDeclared" });
      continue;
    }
    if (owned.has(name)) {
      dropped.push({ name, value, reason: "reserved" });
      continue;
    }
    const fitted = fit(def, value);
    if ("value" in fitted) {
      next[name] = fitted.value;
    } else if ("clampedTo" in fitted) {
      next[name] = fitted.clampedTo;
      clamped.push({ name, value: fitted.clampedTo });
    } else {
      dropped.push({ name, value, reason: fitted.dropped });
    }
  }
  return { options: next, clamped, dropped };
}
