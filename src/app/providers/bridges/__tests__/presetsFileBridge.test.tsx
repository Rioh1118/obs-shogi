// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type {
  EnginePresetsContextType,
  EnginePresetsState,
  PresetsLoadNotice,
  SaveFailure,
} from "@/entities/engine-presets/model/types";
import { initialState } from "@/entities/engine-presets/model/types";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import { PRESETS_SAVE_NOTICES, presetsLoadNoticeView } from "../presetsFileNotice";

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
    await mountWith({
      loadNotice: { kind: "migrated", from: 1, backup: "/cfg/engine_presets.v1.bak" },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const req = shown();
    expect(req.tier).toBe("info");
    expect(req.presentation).toBe("toast");
    // 残したファイルの名前は出す（探して戻せるように）。置き場のフルパスは出さない
    expect(req.body).toContain("engine_presets.v1.bak");
    expect(`${req.title}${req.body}`).not.toContain("/cfg/");
  });

  /** 書けない状態で開いた種類は、読み直す口を持つ帯 */
  test.each<PresetsLoadNotice>([
    { kind: "backupFailed", reason: "EACCES" },
    { kind: "migrationFailed", reason: "EACCES" },
    { kind: "notRecovered", reason: "EACCES" },
    { kind: "unreadable", reason: "EIO" },
  ])("$kind は danger の帯で「読み直す」を持つ", async (notice) => {
    await mountWith({ loadNotice: notice });

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
  });

  /**
   * 段と動作を種類ごとに固定する。**書けない状態で開く種類は `danger`、新しい版だけ `warning`**
   * （直す手段がアプリの更新で、フォルダの問題ではない）
   */
  test.each<[PresetsLoadNotice, string, string | null]>([
    [{ kind: "migrated", from: 1, backup: "/b" }, "info", null],
    [{ kind: "backupFailed", reason: "x" }, "danger", "reload"],
    [{ kind: "migrationFailed", reason: "x" }, "danger", "reload"],
    [{ kind: "recovered", destination: "/d" }, "warning", "settings"],
    [{ kind: "notRecovered", reason: "x" }, "danger", "reload"],
    [{ kind: "newerVersion", version: 3 }, "warning", "settings"],
    [{ kind: "unreadable", reason: "x" }, "danger", "reload"],
  ])("$kind の段と動作", (notice, tier, action) => {
    const view = presetsLoadNoticeView(notice);
    expect(view.tier).toBe(tier);
    expect(view.presentation === "banner" ? view.action : null).toBe(action);
  });

  /** 読めなかったファイルを移した先の名前を出す（1文字直して戻せるように） */
  test("移した先のファイル名を本文に出す", async () => {
    await mountWith({
      loadNotice: { kind: "recovered", destination: "/cfg/engine_presets.unreadable-42.json" },
    });
    expect(banner().body).toContain("engine_presets.unreadable-42.json");
  });

  /** Rust にだけ足された種類でも落ちず、汎用の帯を出す */
  test("知らない種類でも落ちずに帯を出す", async () => {
    await mountWith({ loadNotice: { kind: "somethingNew" } as unknown as PresetsLoadNotice });
    expect(banner().actions.map((a) => a.label)).toEqual(["読み直す"]);
  });

  /** 読み込みの呼び出しそのものが落ちたら、設定を開いていなくても届ける */
  test("読み込めなかったら読み直す口を持つ帯を出す", async () => {
    await mountWith({ status: "error", error: "ipc closed" });
    const req = banner();
    expect(req.tier).toBe("danger");
    expect(req.body).not.toContain("ipc closed");
    await act(async () => {
      await req.actions[0].run();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  /** 読むたびに出し直す。件数が同じままでも、読み直した回には閉じた通知が戻る */
  test("読み直したら、同じ件数でも読めなかった件を伝え直す", async () => {
    presets.state = { ...initialState, unreadableCount: 1, loadSeq: 1 };
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<PresetsFileBridge />);
    });
    expect(notify).toHaveBeenCalledTimes(1);

    presets.state = { ...presets.state, loadSeq: 2 };
    await act(async () => {
      view.rerender(<PresetsFileBridge />);
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
