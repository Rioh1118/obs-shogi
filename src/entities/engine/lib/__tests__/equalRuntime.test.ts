/**
 * **どの欄を比べるかを固定する。**
 *
 * この述語は「起こし直すか」を決める（`docs/state-transitions/engine.md` の ※4）。
 * 欄を1つ見落とすと、その欄だけを変えて保存した回に**エンジンが古い設定のまま走り続ける**
 * ——画面は新しい設定を映しているので、利用者からは見分けが付かない。
 * 逆に余計な欄を見ると、保存のたびに起こし直して解析が切れる。
 *
 * **欄ごとに1本ずつ当てる。** provider を通すテストは `options` しか動かしておらず、
 * そちらでは欄の抜けが観測できない。
 */
import { describe, expect, it } from "vitest";

import { equalRuntime } from "../equalRuntime";
import type { EngineRuntimeConfig } from "@/entities/engine/model/types";

const base: EngineRuntimeConfig = {
  enginePath: "/e",
  workDir: "/w",
  evalDir: "/v",
  bookDir: null,
  bookFile: null,
  options: { Threads: "4" },
};

describe("equalRuntime", () => {
  it("等値な別オブジェクトは同じと見る", () => {
    expect(equalRuntime(base, { ...base, options: { ...base.options } })).toBe(true);
  });

  it.each([
    ["enginePath", { enginePath: "/other" }],
    ["workDir", { workDir: "/other" }],
    ["evalDir", { evalDir: "/other" }],
    ["bookDir", { bookDir: "/books" }],
    ["bookFile", { bookFile: "standard.db" }],
  ] satisfies [string, Partial<EngineRuntimeConfig>][])("%s が動けば別と見る", (_name, patch) => {
    expect(equalRuntime(base, { ...base, ...patch })).toBe(false);
  });

  it.each([
    ["値が変わる", { Threads: "8" }],
    ["欄が増える", { Threads: "4", USI_Hash: "1024" }],
    ["欄が減る", {}],
  ] satisfies [string, Record<string, string>][])("options の %s と別と見る", (_name, options) => {
    expect(equalRuntime(base, { ...base, options })).toBe(false);
  });
});
