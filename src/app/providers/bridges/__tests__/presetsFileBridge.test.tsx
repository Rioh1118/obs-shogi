// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type {
  EnginePresetsContextType,
  EnginePresetsState,
  PresetsNotice,
  SaveFailure,
} from "@/entities/engine-presets/model/types";
import { initialState } from "@/entities/engine-presets/model/types";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import { PRESETS_LOAD_NOTICES, PRESETS_SAVE_NOTICES } from "../presetsFileNotice";

/**
 * プリセットのファイルで起きたことを届ける橋。**設定を開いていなくても届く**——移行は
 * 起動のたびの読み込みで起きる。
 */

const reload = vi.fn<() => Promise<void>>();
const presets = { state: { ...initialState } as EnginePresetsState, reload: () => reload() };
const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();
const openModal = vi.fn();

// 読むのは `state` と `reload` だけ
vi.mock(
  "@/entities/engine-presets/model/useEnginePresets",
  () =>
    ({
      useEnginePresets: () => presets as unknown as EnginePresetsContextType,
    }) satisfies typeof import("@/entities/engine-presets/model/useEnginePresets"),
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

const { PresetsFileBridge } = await import("../PresetsFileBridge");

async function mountWith(patch: Partial<EnginePresetsState>) {
  presets.state = { ...initialState, ...patch };
  await act(async () => {
    render(<PresetsFileBridge />);
  });
}

function shown(at = 0) {
  const req = notify.mock.calls[at][0];
  if (req.tier === "silent") throw new Error("出さない段で呼んでいる");
  return req;
}

/** 帯として出したもの。動作を持つのは帯だけ */
function banner(at = 0) {
  const req = shown(at);
  if (req.presentation !== "banner") throw new Error(`帯でない: ${req.presentation}`);
  return req;
}

beforeEach(() => {
  notify.mockClear();
  dismissByKey.mockClear();
  reload.mockReset();
  reload.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("プリセットのファイルで起きたことを届ける橋", () => {
  test("何も起きていなければ何も出さない", async () => {
    await mountWith({});
    expect(notify).not.toHaveBeenCalled();
  });

  /** 移したことは伝えるだけ（何もしなくてよい）。自分で消える */
  test("移したことは info のトーストで1回だけ伝える", async () => {
    await mountWith({ fileNotice: { kind: "migrated", backup: "/cfg/engine_presets.v1.bak" } });

    expect(notify).toHaveBeenCalledTimes(1);
    const req = shown();
    expect(req.tier).toBe("info");
    expect(req.presentation).toBe("toast");
    // Rust の理由（パス・OS の文言）を本文に出さない
    expect(`${req.title}${req.body}`).not.toContain("/cfg/");
  });

  /** 書けない状態で開いた種類は、読み直す口を持つ帯 */
  test.each<PresetsNotice>([
    { kind: "backupFailed", reason: "EACCES" },
    { kind: "migrationFailed", reason: "EACCES" },
    { kind: "notRecovered", reason: "EACCES" },
    { kind: "unreadable", reason: "EIO" },
  ])("$kind は danger の帯で「読み直す」を持つ", async (notice) => {
    await mountWith({ fileNotice: notice });

    const req = banner();
    expect(req.tier).toBe("danger");
    const labels = req.actions.map((a) => a.label);
    expect(labels).toEqual(["読み直す"]);
    expect(`${req.title}${req.body}`).not.toContain(
      notice.kind === "unreadable" ? "EIO" : "EACCES",
    );
  });

  test("別の場所で変更されたら、帯の「読み直す」で読み直す", async () => {
    const failure: SaveFailure = { kind: "conflict", message: "changed" };
    await mountWith({ saveFailure: failure });

    const req = banner();
    expect(req.title).toContain("別の場所で変更されました");
    await act(async () => {
      await req.actions[0].run();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("読めなかった件があれば件数を伝える", async () => {
    await mountWith({ unreadableCount: 2 });
    expect(shown().title).toContain("2 件");
  });

  /** どの保存の失敗でも、変更が保存されていないことを言う（画面は書けた内容のまま） */
  test("保存の失敗の本文は、どれも変更を保存していないと言う", () => {
    for (const view of Object.values(PRESETS_SAVE_NOTICES)) {
      expect(view.body).toContain("変更は保存していません");
    }
    expect(Object.keys(PRESETS_LOAD_NOTICES).length).toBeGreaterThan(4);
  });
});
