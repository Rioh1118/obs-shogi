import { describe, expect, test } from "vitest";
import { usiOptionsOf } from "@/entities/engine";
import type { EnginePreset } from "@/entities/engine-presets/model/types";
import { enginePlayer, humanPlayer, playerSpecOf } from "../playerSpec";
import { isPlayableTimeControl, toTimeLimit, type TimeControl } from "../timeLimit";

/**
 * 対局を始めるときに Rust へ渡すものの組み立て。
 *
 * **押した後に断られる形を、押す前に作らないこと**が主題。
 * `start_game` は形が通らないと断るだけで、**取り消す口も無いまま数十秒待たせた末に**
 * 落ちることがある（評価関数の読み込みが先に走る）。
 */

const PRESET: EnginePreset = {
  id: "p1",
  label: "やねうら王（研究用）",
  aiName: "yaneuraou",
  enginePath: "/ai/yaneuraou/bin/engine",
  evalFilePath: "/ai/yaneuraou/eval/nn.bin",
  bookEnabled: true,
  bookFilePath: "/ai/yaneuraou/book/standard.db",
  options: { Threads: "4", USI_Hash: "1024" },
};

const control = (over: Partial<TimeControl>): TimeControl => ({
  kind: "byoyomi",
  mainMinutes: "10",
  byoyomiSeconds: "30",
  incrementSeconds: "0",
  ...over,
});

describe("持ち時間", () => {
  /**
   * **秒読みと加算を両方送ると Rust が断る。** 欄を触ってから形を切り替えただけで
   * その組み合わせになるので、選んだ形に属さない欄は 0 にする。
   */
  test("選んだ形に属さない欄は 0 になる", () => {
    const touched = control({ byoyomiSeconds: "30", incrementSeconds: "10" });

    expect(toTimeLimit({ ...touched, kind: "byoyomi" })).toEqual({
      mainMs: 600_000,
      byoyomiMs: 30_000,
      incrementMs: 0,
    });
    expect(toTimeLimit({ ...touched, kind: "fischer" })).toEqual({
      mainMs: 600_000,
      byoyomiMs: 0,
      incrementMs: 10_000,
    });
    expect(toTimeLimit({ ...touched, kind: "sudden" })).toEqual({
      mainMs: 600_000,
      byoyomiMs: 0,
      incrementMs: 0,
    });
  });

  test("持ち時間 0 の秒読みは通る。**切れ負けは通らない**", () => {
    expect(isPlayableTimeControl(control({ mainMinutes: "0" }))).toBe(true);
    expect(isPlayableTimeControl(control({ kind: "sudden", mainMinutes: "0" }))).toBe(false);
  });

  test("負の値と小数は 0 側へ丸める", () => {
    expect(toTimeLimit(control({ mainMinutes: "-5", byoyomiSeconds: "2.9" }))).toEqual({
      mainMs: 0,
      byoyomiMs: 2_000,
      incrementMs: 0,
    });
  });

  /**
   * **`Math.max(0, …)` は `NaN` を吸わない。** 通すと `mainMs: NaN` が
   * `JSON.stringify` で `null` になり、Rust の `u64` が取り込みで落ちる ——
   * そのときには棋譜のファイルが既に作られている。
   */
  test("数でない欄は 0 として扱い、押させない", () => {
    expect(toTimeLimit(control({ mainMinutes: "１０" })).mainMs).toBe(0);
    expect(toTimeLimit(control({ mainMinutes: "あ" })).mainMs).toBe(0);
    expect(toTimeLimit(control({ mainMinutes: "" })).mainMs).toBe(0);

    expect(isPlayableTimeControl(control({ kind: "sudden", mainMinutes: "１０" }))).toBe(false);
  });

  test("前後の空白は落とす", () => {
    expect(toTimeLimit(control({ mainMinutes: " 10 " })).mainMs).toBe(600_000);
  });
});

describe("席", () => {
  test("人の席は名前をそのまま持つ。**切り詰めない**", () => {
    expect(humanPlayer("あ".repeat(200))).toEqual({
      kind: "human",
      name: "あ".repeat(200),
    });
  });

  /**
   * **解析と同じ `setoption` を送る。** 別々に組むと、片方だけ `BookDir` を
   * 送るような食い違いが起きて、エンジンが起動してからしか気づけない。
   */
  test("エンジンの席の `setoption` が、解析の合成と一致する", () => {
    const spec = enginePlayer(PRESET, "/ai", false);
    expect(spec).not.toBeNull();

    const expected = usiOptionsOf({
      enginePath: PRESET.enginePath,
      workDir: "/ai/yaneuraou",
      evalDir: "/ai/yaneuraou/eval",
      bookDir: "/ai/yaneuraou/book",
      bookFile: PRESET.bookFilePath,
      options: PRESET.options,
    });

    expect(spec?.kind).toBe("engine");
    expect(spec?.kind === "engine" ? spec.options : null).toEqual(
      Object.entries(expected).map(([name, value]) => ({ name, value })),
    );
  });

  /** **プリセットの見出しを使う。** エンジンが名乗る `id name` は長さを見ずに保持される */
  test("エンジンの席の名前は、プリセットの見出し", () => {
    const spec = enginePlayer(PRESET, "/ai", false);

    expect(spec?.name).toBe("やねうら王（研究用）");
  });

  test("定跡を切ってあれば `BookFile` を送らない", () => {
    const spec = enginePlayer({ ...PRESET, bookEnabled: false }, "/ai", false);
    const names = spec?.kind === "engine" ? (spec.options ?? []).map((o) => o.name) : [];

    expect(names).not.toContain("BookFile");
    expect(names).not.toContain("BookDir");
  });

  /**
   * **揃っていないプリセットでは始めない。** 選べても始まらないので、
   * 送信を止める材料になる（画面は理由を出す）。
   */
  test("実行ファイルの無いプリセットは座れない", () => {
    expect(enginePlayer({ ...PRESET, enginePath: "" }, "/ai", false)).toBeNull();
  });

  test("AI ライブラリの置き場が決まっていなければ座れない", () => {
    expect(
      playerSpecOf({ kind: "engine", presetId: "p1" }, "先手", [PRESET], null, false),
    ).toBeNull();
  });

  test("知らないプリセットの id は座れない", () => {
    expect(
      playerSpecOf({ kind: "engine", presetId: "なにか" }, "先手", [PRESET], "/ai", false),
    ).toBeNull();
  });
});
