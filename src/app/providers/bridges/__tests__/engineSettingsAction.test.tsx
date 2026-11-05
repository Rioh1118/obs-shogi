// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { EngineStartFailure } from "@/entities/engine";
import { initialState as presetsInitialState } from "@/entities/engine-presets/model/reducer";
import type { EnginePresetsState } from "@/entities/engine-presets";
import type { NotifyAction, NotifyRequest } from "@/shared/lib/notification/types";
import type { ModalType, URLParams } from "@/shared/lib/router/useURLParams";

/**
 * 帯とトーストに付く「設定を開く」が、どの橋でも同じ行き先と同じ断りを持つこと。
 *
 * 押したら設定のエンジン管理を開く。開けなかったときに出す文は、帯がヘッダを覆って
 * 歯車に届かないことを前提に、閉じてから開く手順をタブの名前まで言う。
 * URL が動くと `openModal` は別物になるので、押したときには最新を呼ぶ。
 * 画面が動いただけで通知を出し直さない。
 */

const FAILURE_BODY =
  "この通知を閉じて、画面右上の歯車から設定を開き、「エンジン管理」を選択してください。";

type OpenModal = (modal: ModalType, extra?: Partial<URLParams>) => void;
let openModal = vi.fn<OpenModal>();
const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();

let analysisError: string | null = null;
const engine = {
  state: {
    phase: "idle" as string,
    error: null as EngineStartFailure | null,
    unresponsiveReason: null,
    startWarnings: [] as unknown[],
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
    useURLParams: (() => ({ openModal })) as unknown as typeof actual.useURLParams,
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
  const mocked = {
    ...actual,
    useEngine: (() => engine) as unknown as typeof actual.useEngine,
  };
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

function settingsAction(at: number): NotifyAction {
  const request = notify.mock.calls[at][0];
  if (request.tier === "silent") throw new Error("出さない段で呼んでいる");
  const actions = "actions" in request ? (request.actions ?? []) : [];
  const found = actions.find((a) => a.label === "設定を開く");
  if (!found) throw new Error("「設定を開く」が無い");
  return found;
}

/** 条件を立てて描き、URL だけを動かして描き直す */
async function mountThenMoveURL(element: () => ReactElement) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(element());
  });
  const calls = notify.mock.calls.length;
  openModal = vi.fn<OpenModal>();
  await act(async () => {
    view.rerender(element());
  });
  return calls;
}

const cases: [string, () => void, () => ReactElement][] = [
  [
    "検討の断り",
    () => {
      analysisError = "局面の準備に時間が掛かっています。もう一度 ▶ を押してください。";
    },
    () => <AnalysisRefusalBridge />,
  ],
  [
    "起動の失敗",
    () => {
      engine.state = { ...engine.state, phase: "error", error: failureOf("unknown") };
    },
    () => <EngineFailureBridge />,
  ],
  [
    "起動の長引き",
    () => {
      engine.state = { ...engine.state, phase: "initializing" };
      engine.slowStart = true;
    },
    () => <EngineFailureBridge />,
  ],
  [
    "起動で送らなかった設定",
    () => {
      engine.state = {
        ...engine.state,
        phase: "ready",
        startWarnings: [{ kind: "clamped", name: "Hash", value: "16" }],
      };
    },
    () => <EngineStartWarningBridge />,
  ],
  [
    "プリセットの保存の失敗",
    () => {
      presets.state = { ...presetsInitialState, saveFailure: { kind: "io" } } as EnginePresetsState;
    },
    () => <PresetsFileBridge />,
  ],
];

function failureOf(kind: string): EngineStartFailure {
  return { kind, message: "boom", lastOutput: null } as EngineStartFailure;
}

beforeEach(() => {
  openModal = vi.fn<OpenModal>();
  notify.mockClear();
  dismissByKey.mockClear();
  analysisError = null;
  engine.state = { phase: "idle", error: null, unresponsiveReason: null, startWarnings: [] };
  engine.presetIncomplete = false;
  engine.slowStart = false;
  presets.state = { ...presetsInitialState };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("「設定を開く」", () => {
  test.each(cases)(
    "%s: 開けなかったときの手順をタブの名前まで言う",
    async (_, arrange, element) => {
      arrange();
      await act(async () => {
        render(element());
      });

      expect(settingsAction(notify.mock.calls.length - 1).failureBody).toBe(FAILURE_BODY);
    },
  );

  test.each(cases)(
    "%s: URL が動いても出し直さず、押せばいまの画面の処理でエンジン管理を開く",
    async (_, arrange, element) => {
      arrange();
      const calls = await mountThenMoveURL(element);

      expect(notify.mock.calls.length).toBe(calls);
      const latest = openModal;
      await act(async () => {
        await settingsAction(calls - 1).run();
      });
      expect(latest).toHaveBeenCalledWith("settings", { tab: "engine" });
    },
  );
});
