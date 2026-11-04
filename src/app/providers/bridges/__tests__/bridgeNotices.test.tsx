// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { EngineStartFailure, StartWarning } from "@/entities/engine";
import { initialState as presetsInitialState } from "@/entities/engine-presets/model/reducer";
import type { EnginePresetsState } from "@/entities/engine-presets/model/types";
import type { NotifyAction, NotifyRequest } from "@/shared/lib/notification/types";
import { startWarningBody } from "../startWarningNotice";

/**
 * 橋が出す通知の段・見せ方・本文と、条件を抜けたときに引っ込めること、
 * 押したときに描き直した後の関数を呼ぶこと。
 *
 * どれも外しても型と描画は通る。段を取り違えると帯がトーストになって動作が消え、
 * 引っ込め忘れると直った後も古い帯がヘッダを覆う。ref を書き換えないと、
 * 押したときに作り直す前の関数を呼び、起動し直す先が古いプリセットになる。
 */

const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();

let analysisError: string | null = null;
const engine = {
  state: {
    phase: "idle" as string,
    error: null as EngineStartFailure | null,
    unresponsiveReason: null,
    startWarnings: [] as StartWarning[],
  },
  presetIncomplete: false,
  slowStart: false,
  initialize: vi.fn(),
  cancelStart: vi.fn(),
};
const presets = { state: { ...presetsInitialState } as EnginePresetsState, reload: vi.fn() };

vi.mock("@/shared/lib/notification/useNotifications", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/lib/notification/useNotifications")>();
  const mocked = {
    ...actual,
    useNotify: (() => ({
      notify,
      dismiss: vi.fn(),
      dismissByKey,
    })) as unknown as typeof actual.useNotify,
  };
  return mocked satisfies typeof import("@/shared/lib/notification/useNotifications");
});
vi.mock("@/shared/lib/router/useURLParams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/router/useURLParams")>();
  const mocked = {
    ...actual,
    useURLParams: (() => ({ openModal: vi.fn() })) as unknown as typeof actual.useURLParams,
  };
  return mocked satisfies typeof import("@/shared/lib/router/useURLParams");
});
vi.mock("@/entities/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/analysis")>();
  const mocked = {
    ...actual,
    useAnalysis: (() => ({
      state: { error: analysisError },
    })) as unknown as typeof actual.useAnalysis,
  };
  return mocked satisfies typeof import("@/entities/analysis");
});
vi.mock("@/entities/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/engine")>();
  const mocked = { ...actual, useEngine: (() => engine) as unknown as typeof actual.useEngine };
  return mocked satisfies typeof import("@/entities/engine");
});
vi.mock("@/entities/engine-presets/model/useEnginePresets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/entities/engine-presets/model/useEnginePresets")>();
  const mocked = {
    ...actual,
    useEnginePresets: (() => presets) as unknown as typeof actual.useEnginePresets,
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/useEnginePresets");
});

const { AnalysisRefusalBridge } = await import("../AnalysisRefusalBridge");
const { EngineFailureBridge } = await import("../EngineFailureBridge");
const { EngineStartWarningBridge } = await import("../EngineStartWarningBridge");
const { PresetsFileBridge } = await import("../PresetsFileBridge");

function last(): Exclude<NotifyRequest, { tier: "silent" }> {
  const request = notify.mock.calls[notify.mock.calls.length - 1][0];
  if (request.tier === "silent") throw new Error("出さない段で呼んでいる");
  return request;
}

function actionOf(request: NotifyRequest, label: string): NotifyAction {
  const actions = "actions" in request ? (request.actions ?? []) : [];
  const found = actions.find((a) => a.label === label);
  if (!found) throw new Error(`「${label}」が無い`);
  return found;
}

async function mount(element: () => ReactElement) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(element());
  });
  return async () => {
    await act(async () => {
      view.rerender(element());
    });
  };
}

beforeEach(() => {
  notify.mockClear();
  dismissByKey.mockClear();
  analysisError = null;
  engine.state = { phase: "idle", error: null, unresponsiveReason: null, startWarnings: [] };
  engine.presetIncomplete = false;
  engine.slowStart = false;
  engine.initialize = vi.fn();
  engine.cancelStart = vi.fn();
  presets.state = { ...presetsInitialState };
  presets.reload = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("検討の断り", () => {
  test("断りの文をそのまま本文にした、warning の帯を出す", async () => {
    analysisError = "検討を開始できませんでした。再起動してください。";
    await mount(() => <AnalysisRefusalBridge />);

    expect(last()).toMatchObject({
      tier: "warning",
      presentation: "banner",
      body: "検討を開始できませんでした。再起動してください。",
    });
  });

  test("再起動は、描き直した後の起動の関数を呼ぶ", async () => {
    analysisError = "検討を開始できませんでした。再起動してください。";
    const redraw = await mount(() => <AnalysisRefusalBridge />);
    const latest = vi.fn();
    engine.initialize = latest;
    await redraw();

    await act(async () => {
      await actionOf(notify.mock.calls[0][0], "再起動").run();
    });

    expect(latest).toHaveBeenCalledTimes(1);
  });
});

describe("エンジンの失敗", () => {
  test("起動の中止は、描き直した後の中止の関数を呼ぶ", async () => {
    engine.state = { ...engine.state, phase: "initializing" };
    engine.slowStart = true;
    const redraw = await mount(() => <EngineFailureBridge />);
    const latest = vi.fn();
    engine.cancelStart = latest;
    await redraw();

    await act(async () => {
      await actionOf(notify.mock.calls[0][0], "起動を中止").run();
    });

    expect(latest).toHaveBeenCalledTimes(1);
  });

  test("もう一度起動は、描き直した後の起動の関数を呼ぶ", async () => {
    engine.state = {
      ...engine.state,
      phase: "error",
      error: { kind: "unknown", message: "boom", lastOutput: null } as EngineStartFailure,
    };
    const redraw = await mount(() => <EngineFailureBridge />);
    const latest = vi.fn();
    engine.initialize = latest;
    await redraw();

    await act(async () => {
      await actionOf(notify.mock.calls[0][0], "もう一度起動").run();
    });

    expect(latest).toHaveBeenCalledTimes(1);
  });

  test("起動の失敗の種類とエンジンの文言はログへ回す", async () => {
    engine.state = {
      ...engine.state,
      phase: "error",
      error: {
        kind: "unknown",
        message: "engine said boom",
        lastOutput: null,
      } as EngineStartFailure,
    };
    await mount(() => <EngineFailureBridge />);

    expect(console.error).toHaveBeenCalledWith(
      "[engine] 起動に失敗した",
      "unknown",
      "engine said boom",
    );
  });
});

describe("起動で送らなかった設定", () => {
  const warnings: StartWarning[] = [{ kind: "clamped", name: "Hash", value: "16" }];

  test("起動し直している間は、前の起動の警告を出さない", async () => {
    engine.state = { ...engine.state, phase: "initializing", startWarnings: warnings };
    await mount(() => <EngineStartWarningBridge />);

    expect(notify).not.toHaveBeenCalled();
  });

  test("起動の段を抜けたら引っ込める", async () => {
    engine.state = { ...engine.state, phase: "ready", startWarnings: warnings };
    const redraw = await mount(() => <EngineStartWarningBridge />);
    engine.state = { ...engine.state, phase: "initializing" };
    await redraw();

    expect(dismissByKey).toHaveBeenCalledWith("engine-start-warnings");
  });
});

describe("プリセットのファイル", () => {
  test("同じ知らせでも、読み直したら出し直す", async () => {
    const loadNotice = { kind: "recovered", destination: "/c/presets.broken.json" } as const;
    presets.state = { ...presetsInitialState, loadNotice, loadSeq: 1 };
    const redraw = await mount(() => <PresetsFileBridge />);
    presets.state = { ...presets.state, loadSeq: 2 };
    await redraw();

    expect(notify).toHaveBeenCalledTimes(2);
  });

  test.each([
    [
      "読み込みで起きたこと",
      { loadNotice: { kind: "recovered", destination: "/c/x.json" } },
      { loadNotice: null },
      "presets-load-notice",
    ],
    ["読み込みの失敗", { status: "error" }, { status: "ok" }, "presets-load-failure"],
    ["読めなかった件", { unreadableCount: 2 }, { unreadableCount: 0 }, "presets-unreadable"],
    ["保存の失敗", { saveFailure: { kind: "io" } }, { saveFailure: null }, "presets-save-failure"],
  ] as const)("%s が消えたら引っ込める", async (_, before, after, key) => {
    presets.state = { ...presetsInitialState, ...before } as EnginePresetsState;
    const redraw = await mount(() => <PresetsFileBridge />);
    presets.state = { ...presets.state, ...after } as EnginePresetsState;
    await redraw();

    expect(dismissByKey).toHaveBeenCalledWith(key);
  });

  test("移したことのトーストは自分で消え、帯は引っ込める取っ手を持つ", async () => {
    presets.state = {
      ...presetsInitialState,
      loadNotice: { kind: "migrated", from: 1, backup: "/c/presets.v1.json" },
    };
    await mount(() => <PresetsFileBridge />);
    expect(last()).toMatchObject({ presentation: "toast", autoDismiss: true });

    notify.mockClear();
    cleanup();
    presets.state = { ...presetsInitialState, saveFailure: { kind: "conflict", message: "x" } };
    await mount(() => <PresetsFileBridge />);
    expect(last()).toMatchObject({ presentation: "banner", dismissKey: "presets-save-failure" });
  });

  test("もう一度読み込むは、描き直した後の読み直しの関数を呼ぶ", async () => {
    presets.state = { ...presetsInitialState, status: "error" };
    const redraw = await mount(() => <PresetsFileBridge />);
    const latest = vi.fn(() => Promise.resolve());
    presets.reload = latest;
    await redraw();

    await act(async () => {
      await actionOf(notify.mock.calls[0][0], "もう一度読み込む").run();
    });

    expect(latest).toHaveBeenCalledTimes(1);
  });
});

describe("起動で送らなかった設定の本文", () => {
  const clamped = (name: string): StartWarning => ({ kind: "clamped", name, value: "1" });

  test("載せられる件数ちょうどなら、残りの件数を言わない", () => {
    const body = startWarningBody([clamped("A"), clamped("B"), clamped("C")]);

    expect(body?.split("\n")).toHaveLength(3);
    expect(body).not.toContain("ほか");
  });

  test("載せきれないときも、載せた件を1件ずつ行に分け、残りの件数を最後の行に書く", () => {
    const body = startWarningBody([clamped("A"), clamped("B"), clamped("C"), clamped("D")]);

    expect(body?.split("\n")).toEqual([
      expect.stringContaining("A"),
      expect.stringContaining("B"),
      expect.stringContaining("C"),
      "ほか 1 件。",
    ]);
  });

  test("1件ずつ行を分ける", () => {
    expect(startWarningBody([clamped("A"), clamped("B")])?.split("\n")).toHaveLength(2);
  });

  test("知らない種類は汎用の1文にする", () => {
    const unknown = { kind: "fromTheFuture", name: "X" } as unknown as StartWarning;

    expect(startWarningBody([unknown])).toBe("保存した設定の一部を送っていません。");
  });
});
