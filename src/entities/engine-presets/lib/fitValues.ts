import type { StartWarning, UsiOptionDef } from "@/entities/engine";
import type { UsiOptionMap } from "../model/types";

/**
 * 定義に当てて外した利用者の値1件と、その理由。理由の綴りは起動の警告（Rust の `StartWarning`）と
 * 同じ語を使う——片方だけ改名すると、保存の前に見せる理由と起動で出る理由が別の語になる。
 * `button` だけは起動の警告に無い（送る側は黙って送らない）
 */
export type DroppedValue = {
  name: string;
  value: string;
  reason:
    | Extract<
        StartWarning["kind"],
        "notDeclared" | "overriddenByBinding" | "notInVars" | "invalidType"
      >
    | "button";
};

/** 範囲の外にあって丸めた値。元の値と、エンジンの範囲も持つ（画面が何をどう変えたかを言うため） */
export type ClampedValue = {
  name: string;
  from: string;
  value: string;
  min: number | null;
  max: number | null;
};

export type FittedValues = {
  options: UsiOptionMap;
  clamped: ClampedValue[];
  dropped: DroppedValue[];
};

/** Rust の `i64` に収まる範囲。送る側はこれを超える整数を型の合わない値として送らない */
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

/** 保存した値を整数として読む（前後の空白は許す）。整数でなければ `null` */
export function parseSpinValue(value: string): bigint | null {
  if (!/^\s*[+-]?\d+\s*$/.test(value)) return null;
  const n = BigInt(value.trim());
  return n < I64_MIN || n > I64_MAX ? null : n;
}

type Fit = { value: string } | { clampedTo: string } | { dropped: DroppedValue["reason"] };

/**
 * 値1件を定義に当てる。**送る側（Rust の `binding::user_value`）と同じ規則**にする——画面で残した値が
 * 起動のたびに捨てられる・丸められる、を作らない。両方が同じ表（`src-tauri/tests/fixtures/
 * option_fit_cases.json`）を当てて、ずれたら落ちる
 */
function fit(def: UsiOptionDef, value: string): Fit {
  switch (def.type) {
    case "check": {
      const v = value.toLowerCase();
      return v === "true" || v === "false" ? { value: v } : { dropped: "invalidType" };
    }
    case "spin": {
      const n = parseSpinValue(value);
      if (n == null) return { dropped: "invalidType" };
      const lo = def.min == null ? I64_MIN : BigInt(def.min);
      const hi = def.max == null ? I64_MAX : BigInt(def.max);
      const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];
      const clamped = n < low ? low : n > high ? high : n;
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
 * 利用者の値を、エンジンの定義に当てる。定義に無い名前・アプリが決める名前（`reserved`。評価関数・定跡の
 * 欄と解析の固定値）・
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
      dropped.push({ name, value, reason: "overriddenByBinding" });
      continue;
    }
    const fitted = fit(def, value);
    if ("value" in fitted) {
      next[name] = fitted.value;
    } else if ("clampedTo" in fitted) {
      next[name] = fitted.clampedTo;
      clamped.push({
        name,
        from: value,
        value: fitted.clampedTo,
        min: def.type === "spin" ? def.min : null,
        max: def.type === "spin" ? def.max : null,
      });
    } else {
      dropped.push({ name, value, reason: fitted.dropped });
    }
  }
  return { options: next, clamped, dropped };
}
