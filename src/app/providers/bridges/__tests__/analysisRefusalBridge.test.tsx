// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { NotifyRequest } from "@/shared/lib/notification/types";

const START_REFUSED_MESSAGE = "検討を開始できませんでした。再起動してください。";
const RESTART_FAILED_MESSAGE = "検討を再開できませんでした。再起動してください。";
const POSITION_SYNC_TIMEOUT_MESSAGE =
  "局面の準備に時間が掛かっています。もう一度 ▶ を押してください。";

/** (V2, E16) (V3, E16) AC-23: 検討の断りは帯に出る */
let error: string | null = null;
const initialize = vi.fn<() => Promise<boolean>>();
const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();
const openModal = vi.fn();

vi.mock(
  "@/entities/analysis",
  async (actual) =>
    ({
      ...(await actual<typeof import("@/entities/analysis")>()),
      useAnalysis: (() => ({
        state: { error },
      })) as unknown as typeof import("@/entities/analysis").useAnalysis,
    }) satisfies typeof import("@/entities/analysis"),
);
vi.mock(
  "@/entities/engine",
  async (actual) =>
    ({
      ...(await actual<typeof import("@/entities/engine")>()),
      useEngine: (() => ({
        initialize,
      })) as unknown as typeof import("@/entities/engine").useEngine,
    }) satisfies typeof import("@/entities/engine"),
);
vi.mock(
  "@/shared/lib/notification/useNotifications",
  async (actual) =>
    ({
      ...(await actual<typeof import("@/shared/lib/notification/useNotifications")>()),
      useNotify: () => ({ notify, dismiss: vi.fn(), dismissByKey }),
    }) satisfies typeof import("@/shared/lib/notification/useNotifications"),
);
vi.mock(
  "@/shared/lib/router/useURLParams",
  async (actual) =>
    ({
      ...(await actual<typeof import("@/shared/lib/router/useURLParams")>()),
      useURLParams: (() => ({
        openModal,
      })) as unknown as typeof import("@/shared/lib/router/useURLParams").useURLParams,
    }) satisfies typeof import("@/shared/lib/router/useURLParams"),
);

const { AnalysisRefusalBridge } = await import("../AnalysisRefusalBridge");

const firstAction = () => {
  const request = notify.mock.calls[0][0];
  if (request.tier === "silent" || request.presentation === "toast") {
    throw new Error("帯になっていない");
  }
  const action = request.actions?.[0];
  if (!action) throw new Error("動作が無い");
  return action;
};

beforeEach(() => {
  error = null;
  notify.mockClear();
  dismissByKey.mockClear();
  initialize.mockReset();
  initialize.mockResolvedValue(true);
  openModal.mockClear();
});
afterEach(cleanup);

describe("検討の断りの帯", () => {
  test("断りが無ければ出さない", () => {
    render(<AnalysisRefusalBridge />);
    expect(notify).not.toHaveBeenCalled();
  });

  test.each([START_REFUSED_MESSAGE, RESTART_FAILED_MESSAGE])(
    "%s は再起動のボタンを添える",
    async (message) => {
      error = message;
      render(<AnalysisRefusalBridge />);

      expect(firstAction().label).toBe("再起動");
      await act(async () => {
        await firstAction().run();
      });
      expect(initialize).toHaveBeenCalledTimes(1);
    },
  );

  test("再起動で直らない断りは設定へ送る", () => {
    error = POSITION_SYNC_TIMEOUT_MESSAGE;
    render(<AnalysisRefusalBridge />);

    expect(firstAction().label).toBe("設定を開く");
  });

  test("断りが消えたら引っ込める", () => {
    error = START_REFUSED_MESSAGE;
    const view = render(<AnalysisRefusalBridge />);

    error = null;
    view.rerender(<AnalysisRefusalBridge />);

    expect(dismissByKey).toHaveBeenCalledWith("analysis-refusal");
  });
});
