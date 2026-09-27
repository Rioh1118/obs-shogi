// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { EnginePhase, StartWarning } from "@/entities/engine";
import type { NotifyRequest } from "@/shared/lib/notification/types";

/**
 * 起動はできたが、保存した設定の一部を送らなかったことを伝える橋（`binding.rs` の警告）。
 */

const engine = { state: { phase: "idle" as EnginePhase, startWarnings: [] as StartWarning[] } };
const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();
const openModal = vi.fn();

// 読むのは `state.phase` と `state.startWarnings` だけ
vi.mock(
  "@/entities/engine",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/entities/engine")>()),
      useEngine: () =>
        engine as unknown as ReturnType<typeof import("@/entities/engine").useEngine>,
    }) satisfies typeof import("@/entities/engine"),
);
vi.mock(
  "@/shared/lib/notification/useNotifications",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/shared/lib/notification/useNotifications")>()),
      useNotify: () =>
        ({ notify, dismiss: vi.fn(), dismissByKey }) as unknown as ReturnType<
          typeof import("@/shared/lib/notification/useNotifications").useNotify
        >,
    }) satisfies typeof import("@/shared/lib/notification/useNotifications"),
);
vi.mock(
  "@/shared/lib/router/useURLParams",
  async (importActual) =>
    ({
      ...(await importActual<typeof import("@/shared/lib/router/useURLParams")>()),
      useURLParams: () =>
        ({ openModal }) as unknown as ReturnType<
          typeof import("@/shared/lib/router/useURLParams").useURLParams
        >,
    }) satisfies typeof import("@/shared/lib/router/useURLParams"),
);

const { EngineStartWarningBridge } = await import("../EngineStartWarningBridge");

async function readyWith(startWarnings: StartWarning[]) {
  engine.state = { phase: "ready", startWarnings };
  await act(async () => {
    render(<EngineStartWarningBridge />);
  });
}

function toast() {
  const req = notify.mock.calls[0][0];
  if (req.tier === "silent" || req.presentation !== "toast" || req.autoDismiss) {
    throw new Error("動作を持つトーストでない");
  }
  return req;
}

beforeEach(() => {
  notify.mockClear();
  dismissByKey.mockClear();
  openModal.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("起動で送らなかった設定を伝える", () => {
  test("送らなかった設定があれば、何を送らずどうなったかを info のトーストで伝える", async () => {
    await readyWith([
      { kind: "invalidType", name: "Threads", value: "lots" },
      { kind: "bookNameNotInVars", file: "my_book.db" },
    ]);

    const req = toast();
    expect(req.tier).toBe("info");
    expect(req.body).toContain("Threads");
    expect(req.body).toContain("my_book.db");
    // 送らなかった定跡は切っている（別の定跡で動いていない）ことを言う
    expect(req.body).toContain("定跡なしで解析");
  });

  test("「設定を開く」でエンジン管理を開く", async () => {
    await readyWith([{ kind: "evalNotChosen", name: "EvalDir" }]);

    await act(async () => {
      await (toast().actions ?? [])[0].run();
    });
    expect(openModal).toHaveBeenCalledWith("settings", { tab: "engine" });
  });

  test("全部送れたら何も出さない", async () => {
    await readyWith([]);
    expect(notify).not.toHaveBeenCalled();
  });

  /**
   * **申告に無いだけの値では出さない。** 利用者が触っていない保存済みの値（`NetworkDelay` など）を
   * 申告しないエンジンで起動のたびに出ると、本物の警告まで読まれなくなる
   */
  test("申告に無い値だけなら出さない", async () => {
    await readyWith([
      { kind: "notDeclared", name: "Threads" },
      { kind: "notDeclared", name: "MultiPV" },
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  /** 多いと読めないので先頭の数件だけ。残りは件数で */
  test("多ければ先頭の数件と残りの件数", async () => {
    await readyWith(
      Array.from({ length: 5 }, (_, i) => ({
        kind: "invalidType" as const,
        name: `Opt${i}`,
        value: "x",
      })),
    );
    expect(toast().body).toContain("Opt0");
    expect(toast().body).not.toContain("Opt4");
    expect(toast().body).toContain("ほか 2 件");
  });
});
