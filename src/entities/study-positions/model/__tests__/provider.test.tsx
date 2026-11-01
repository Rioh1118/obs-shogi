// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudyPositionsProvider } from "../provider";
import type { CreateStudyPositionInput, StudyPosition } from "../types";
import { useStudyPositions } from "../useStudyPositions";

const { loadStudyPositions, saveStudyPositions } = vi.hoisted(() => ({
  loadStudyPositions: vi.fn(),
  saveStudyPositions: vi.fn(),
}));

vi.mock(
  "../../api/studyPositions",
  () =>
    ({
      loadStudyPositions,
      saveStudyPositions,
    }) satisfies typeof import("../../api/studyPositions"),
);

const SFEN_A = "9/9/9/9/9/9/9/9/9 b - 1";
const SFEN_A_LATER = "9/9/9/9/9/9/9/9/9 b - 40";
const SFEN_B = "9/9/9/9/9/9/9/9/9 w - 2";
const SFEN_C = "9/9/9/9/9/9/9/9/k b - 3";

function stored(id: string, sfen: string, overrides: Partial<StudyPosition> = {}): StudyPosition {
  return {
    id,
    sfen,
    label: `局面${id}`,
    description: "",
    state: "inbox",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(
  sfen: string,
  overrides: Partial<CreateStudyPositionInput> = {},
): CreateStudyPositionInput {
  return { sfen, label: "新しい局面", description: "", state: "inbox", tags: [], ...overrides };
}

function wrapper({ children }: { children: ReactNode }) {
  return <StudyPositionsProvider>{children}</StudyPositionsProvider>;
}

/** 読み込みが終わるまで描いて、画面の側から見える値を返す */
async function mounted(positions: StudyPosition[]) {
  loadStudyPositions.mockResolvedValue({ positions });
  const view = renderHook(() => useStudyPositions(), { wrapper });
  await waitFor(() => expect(loadStudyPositions).toHaveBeenCalled());
  await act(async () => {});
  return view;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ids(view: Awaited<ReturnType<typeof mounted>>) {
  return view.result.current.state.positions.map((p) => p.id);
}

beforeEach(() => {
  loadStudyPositions.mockReset();
  saveStudyPositions.mockReset();
  saveStudyPositions.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("読み込み", () => {
  it("空白を落とし、タグの空と重複を畳んで載せる", async () => {
    const view = await mounted([
      stored("a", `  ${SFEN_A}  `, {
        label: " 題 ",
        description: "\nメモ\n",
        tags: [" 角換わり ", "", "角換わり", "矢倉"],
      }),
    ]);

    expect(view.result.current.state.positions[0]).toMatchObject({
      sfen: SFEN_A,
      label: "題",
      description: "メモ",
      tags: ["角換わり", "矢倉"],
    });
  });

  it("失敗の理由を error に残し、一覧は空のまま", async () => {
    loadStudyPositions.mockRejectedValue(new Error("読めない"));
    const view = renderHook(() => useStudyPositions(), { wrapper });

    await waitFor(() => expect(view.result.current.state.error).toBe("読めない"));
    expect(view.result.current.state.positions).toEqual([]);
  });
});

describe("findBySfen", () => {
  it("手数が違っても同じ局面を返す", async () => {
    const view = await mounted([stored("a", SFEN_A), stored("b", SFEN_B)]);

    expect(view.result.current.findBySfen(SFEN_A_LATER)?.id).toBe("a");
  });

  it("空の入力、壊れた SFEN、未収録の局面は null を返す", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    expect(view.result.current.findBySfen(null)).toBeNull();
    expect(view.result.current.findBySfen(undefined)).toBeNull();
    expect(view.result.current.findBySfen("壊れた")).toBeNull();
    expect(view.result.current.findBySfen(SFEN_B)).toBeNull();
  });

  it("追加した局面をその場で引ける", async () => {
    const view = await mounted([]);

    await act(async () => {
      await view.result.current.addPosition(input(SFEN_A));
    });
    expect(view.result.current.findBySfen(SFEN_A)?.label).toBe("新しい局面");
  });
});

describe("addPosition", () => {
  it("先頭に足し、作成と更新の時刻を揃え、同じ一覧を書く", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    let added!: StudyPosition;
    await act(async () => {
      added = await view.result.current.addPosition(
        input(SFEN_B, { label: " 題 ", tags: ["x", " x "] }),
      );
    });

    expect(added.label).toBe("題");
    expect(added.tags).toEqual(["x"]);
    expect(added.id).not.toBe("");
    expect(added.createdAt).toBe(added.updatedAt);
    expect(ids(view)).toEqual([added.id, "a"]);
    expect(saveStudyPositions).toHaveBeenCalledTimes(1);
    expect(saveStudyPositions.mock.calls[0]![0].positions.map((p: StudyPosition) => p.id)).toEqual([
      added.id,
      "a",
    ]);
  });

  it("同じ局面は手数が違っても断り、書かない", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    await expect(view.result.current.addPosition(input(SFEN_A_LATER))).rejects.toThrow(
      "already exists",
    );
    expect(saveStudyPositions).not.toHaveBeenCalled();
  });

  it("壊れた SFEN は断り、書かない", async () => {
    const view = await mounted([]);

    await expect(view.result.current.addPosition(input("壊れた"))).rejects.toThrow("Invalid SFEN");
    expect(saveStudyPositions).not.toHaveBeenCalled();
  });

  /** 読み込みの前に書くと、読めるはずの一覧を空として保存し、ファイルの中身を失う */
  it("読み込みが終わるまで待ち、読めた一覧へ足す", async () => {
    const load = deferred<{ positions: StudyPosition[] }>();
    loadStudyPositions.mockReturnValue(load.promise);
    const view = renderHook(() => useStudyPositions(), { wrapper });

    let adding!: Promise<StudyPosition>;
    act(() => {
      adding = view.result.current.addPosition(input(SFEN_B));
    });
    await act(async () => {});
    expect(saveStudyPositions).not.toHaveBeenCalled();

    await act(async () => {
      load.resolve({ positions: [stored("a", SFEN_A)] });
      await adding;
    });
    expect(saveStudyPositions.mock.calls[0]![0].positions).toHaveLength(2);
  });

  it("保存の応答を待たずに一覧へ出す", async () => {
    const view = await mounted([]);
    const save = deferred<void>();
    saveStudyPositions.mockReturnValue(save.promise);

    let adding!: Promise<StudyPosition>;
    await act(async () => {
      adding = view.result.current.addPosition(input(SFEN_A));
    });
    expect(view.result.current.state.positions).toHaveLength(1);

    await act(async () => {
      save.resolve();
      await adding;
    });
    expect(view.result.current.state.positions).toHaveLength(1);
  });

  it("保存に失敗したら一覧を戻し、理由を残し、呼び手へ投げ直す", async () => {
    const view = await mounted([stored("a", SFEN_A)]);
    saveStudyPositions.mockRejectedValue(new Error("書けない"));

    await act(async () => {
      await expect(view.result.current.addPosition(input(SFEN_B))).rejects.toThrow("書けない");
    });

    expect(ids(view)).toEqual(["a"]);
    expect(view.result.current.state.error).toBe("書けない");
    expect(view.result.current.findBySfen(SFEN_B)).toBeNull();
  });

  it("次の保存が通れば、前の失敗の理由を消す", async () => {
    const view = await mounted([]);
    saveStudyPositions.mockRejectedValueOnce(new Error("書けない"));

    await act(async () => {
      await view.result.current.addPosition(input(SFEN_A)).catch(() => undefined);
    });
    expect(view.result.current.state.error).toBe("書けない");

    await act(async () => {
      await view.result.current.addPosition(input(SFEN_A));
    });
    expect(view.result.current.state.error).toBeNull();
  });

  /** 2件目が1件目を知らない一覧を書くと、1件目がファイルから消える */
  it("続けて足しても、後の保存が前の局面を持つ", async () => {
    const view = await mounted([]);

    await act(async () => {
      await Promise.all([
        view.result.current.addPosition(input(SFEN_A)),
        view.result.current.addPosition(input(SFEN_B)),
      ]);
    });

    expect(view.result.current.state.positions).toHaveLength(2);
    expect(saveStudyPositions.mock.lastCall![0].positions).toHaveLength(2);
  });
});

describe("updatePosition", () => {
  it("渡した欄だけを差し替え、更新の時刻だけを進める", async () => {
    const original = stored("a", SFEN_A, { description: "残る", tags: ["残る"], state: "active" });
    const view = await mounted([original]);

    let updated!: StudyPosition;
    await act(async () => {
      updated = await view.result.current.updatePosition({ id: "a", label: " 新しい題 " });
    });

    expect(updated).toMatchObject({
      label: "新しい題",
      description: "残る",
      tags: ["残る"],
      state: "active",
      sfen: SFEN_A,
      createdAt: original.createdAt,
    });
    expect(updated.updatedAt).not.toBe(original.updatedAt);
    expect(view.result.current.state.positions[0]).toEqual(updated);
    expect(saveStudyPositions.mock.calls[0]![0].positions[0]).toEqual(updated);
  });

  it("空の文字列と空の配列は、欄を空にする指示として受ける", async () => {
    const view = await mounted([stored("a", SFEN_A, { description: "消える", tags: ["消える"] })]);

    await act(async () => {
      await view.result.current.updatePosition({ id: "a", description: "", tags: [] });
    });

    expect(view.result.current.state.positions[0]).toMatchObject({ description: "", tags: [] });
  });

  it("全部の欄を差し替えられる", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    await act(async () => {
      await view.result.current.updatePosition({
        id: "a",
        sfen: SFEN_B,
        label: "題",
        description: "メモ",
        state: "done",
        tags: ["x"],
      });
    });

    expect(view.result.current.state.positions[0]).toMatchObject({
      sfen: SFEN_B,
      label: "題",
      description: "メモ",
      state: "done",
      tags: ["x"],
    });
  });

  it("自分と同じ局面のままなら断らない", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    await act(async () => {
      await view.result.current.updatePosition({ id: "a", sfen: SFEN_A_LATER });
    });

    expect(view.result.current.state.positions[0]!.sfen).toBe(SFEN_A_LATER);
  });

  it("別の項目と同じ局面になるなら断り、書かない", async () => {
    const view = await mounted([stored("a", SFEN_A), stored("b", SFEN_B)]);

    await expect(view.result.current.updatePosition({ id: "a", sfen: SFEN_B })).rejects.toThrow(
      "already exists",
    );
    expect(saveStudyPositions).not.toHaveBeenCalled();
  });

  it("壊れた SFEN へは変えられない", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    await expect(view.result.current.updatePosition({ id: "a", sfen: "壊れた" })).rejects.toThrow(
      "Invalid SFEN",
    );
    expect(saveStudyPositions).not.toHaveBeenCalled();
  });

  it("無い項目は断る", async () => {
    const view = await mounted([]);

    await expect(view.result.current.updatePosition({ id: "x", label: "題" })).rejects.toThrow(
      "not found",
    );
  });

  it("保存に失敗したら元の値へ戻す", async () => {
    const view = await mounted([stored("a", SFEN_A), stored("b", SFEN_B)]);
    saveStudyPositions.mockRejectedValue(new Error("書けない"));

    await act(async () => {
      await expect(
        view.result.current.updatePosition({ id: "a", sfen: SFEN_C, label: "題" }),
      ).rejects.toThrow("書けない");
    });

    expect(view.result.current.state.positions[0]!.label).toBe("局面a");
    expect(view.result.current.findBySfen(SFEN_A)?.id).toBe("a");
    expect(view.result.current.findBySfen(SFEN_C)).toBeNull();
  });
});

describe("deletePosition", () => {
  it("消して、残りを書く", async () => {
    const view = await mounted([stored("a", SFEN_A), stored("b", SFEN_B)]);

    await act(async () => {
      await view.result.current.deletePosition("a");
    });

    expect(ids(view)).toEqual(["b"]);
    expect(saveStudyPositions.mock.calls[0]![0].positions.map((p: StudyPosition) => p.id)).toEqual([
      "b",
    ]);
    expect(view.result.current.findBySfen(SFEN_A)).toBeNull();
  });

  it("無い項目は何もしない", async () => {
    const view = await mounted([stored("a", SFEN_A)]);

    await act(async () => {
      await view.result.current.deletePosition("x");
    });

    expect(ids(view)).toEqual(["a"]);
    expect(saveStudyPositions).not.toHaveBeenCalled();
  });

  it("保存に失敗したら戻す", async () => {
    const view = await mounted([stored("a", SFEN_A), stored("b", SFEN_B)]);
    saveStudyPositions.mockRejectedValue(new Error("書けない"));

    await act(async () => {
      await expect(view.result.current.deletePosition("a")).rejects.toThrow("書けない");
    });

    expect(ids(view)).toEqual(["a", "b"]);
    expect(view.result.current.findBySfen(SFEN_A)?.id).toBe("a");
  });
});

describe("useStudyPositions", () => {
  it("provider の外では投げる", () => {
    expect(() => renderHook(() => useStudyPositions())).toThrow("StudyPositionsProvider");
  });
});
