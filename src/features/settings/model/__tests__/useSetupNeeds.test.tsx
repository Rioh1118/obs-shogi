// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

/**
 * 設定の左の一覧で ⚠ を出すタブ。**そのままではエンジンが動かないときだけ出す。**
 * いつも出ていると、直す必要があるときに読まれない。
 */

const READY = { id: "p1", enginePath: "/e/engine" };
const EMPTY = { id: "p2", enginePath: "" };

const world = vi.hoisted(() => ({
  config: null as { ai_root?: string | null } | null,
  presets: {
    status: "ok",
    presets: [] as unknown[],
    selectedPresetId: null as string | null,
    writable: true,
  },
}));

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({ config: world.config })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => {
  const mocked = {
    useEnginePresets: (() => ({
      state: world.presets,
    })) as unknown as typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets,
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/useEnginePresets");
});

const { useSetupNeeds } = await import("../useSetupNeeds");

const needs = () => [...renderHook(() => useSetupNeeds()).result.current];

beforeEach(() => {
  world.config = { ai_root: "/ai" };
  world.presets = { status: "ok", presets: [READY, EMPTY], selectedPresetId: "p1", writable: true };
});
afterEach(cleanup);

test("揃っていれば、どこにも出さない", () => {
  expect(needs()).toEqual([]);
});

describe("AI ライブラリ", () => {
  test.each([null, undefined, "", "  "])("フォルダが %j なら出す", (ai_root) => {
    world.config = { ai_root };

    expect(needs()).toEqual(["aiLibrary"]);
  });

  test("設定を読み終えるまでは出さない", () => {
    world.config = null;

    expect(needs()).toEqual([]);
  });
});

describe("エンジン管理", () => {
  test("適用中のプリセットにエンジンが無ければ出す", () => {
    world.presets.selectedPresetId = "p2";

    expect(needs()).toEqual(["engine"]);
  });

  test("適用していなければ出す", () => {
    world.presets.selectedPresetId = null;

    expect(needs()).toEqual(["engine"]);
  });

  test("ファイルに書けなければ出す", () => {
    world.presets.writable = false;

    expect(needs()).toEqual(["engine"]);
  });

  test("ほかのプリセットが要設定でも、適用中が揃っていれば出さない", () => {
    expect(needs()).toEqual([]);
  });

  test.each(["loading", "error"])("読み終えるまで（%s）は出さない", (status) => {
    world.presets = { status, presets: [], selectedPresetId: null, writable: false };

    expect(needs()).toEqual([]);
  });
});
