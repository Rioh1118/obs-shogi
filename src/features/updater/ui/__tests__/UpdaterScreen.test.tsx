// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UpdaterStatus } from "@/entities/updater";

/**
 * 更新の帯。段階ごとの見出し、押せるもの、閉じられるかを見る。
 * 表は `docs/spec/screens/system-dialogs.md` の「更新」。
 *
 * 取得と入替の最中に閉じられると、進み具合を見る帯が消える。
 */

const updater = vi.hoisted(() => ({
  status: { phase: "idle" } as UpdaterStatus,
  downloadAndInstall: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
  dismiss: vi.fn(),
  skipCurrentVersion: vi.fn(async () => {}),
}));

vi.mock("@/entities/updater", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/updater")>();
  const mocked = {
    ...actual,
    useUpdater: () => updater as unknown as ReturnType<typeof actual.useUpdater>,
  };
  return mocked satisfies typeof import("@/entities/updater");
});

const { default: UpdaterScreen } = await import("../UpdaterScreen");

beforeEach(() => {
  vi.clearAllMocks();
  updater.status = { phase: "idle" };
});

afterEach(() => {
  cleanup();
});

function show(status: UpdaterStatus) {
  updater.status = status;
  render(<UpdaterScreen />);
}

function band() {
  return document.body.querySelector<HTMLElement>(".notice-band")!;
}

const CLOSE = /を閉じる$/;

/** 帯の動作は、押したあとに走る（`useNoticeActions`） */
async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function buttonNames(): string[] {
  return screen
    .queryAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

describe("描かない段階", () => {
  test.each(["idle", "checking"] as const)("%s では何も描かない", (phase) => {
    show({ phase });

    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.querySelector(".updater-band")).toBeNull();
  });
});

describe("段階ごとの見出しと押せるもの", () => {
  test("available: 版を出し、飛ばすか更新するかを選べて、閉じられる", async () => {
    show({ phase: "available", version: "1.2.3" });

    expect(band().textContent).toContain("新しいバージョンが利用可能");
    expect(screen.getByText("バージョン v1.2.3 が公開されています")).toBeTruthy();
    expect(band().className).toContain("notice-band--info");
    expect(document.body.querySelector(".updater-band__progress")).toBeNull();
    expect(buttonNames()).toEqual([
      "今すぐ更新",
      "この版は飛ばす",
      "「新しいバージョンが利用可能」を閉じる",
    ]);

    await press("この版は飛ばす");
    expect(updater.skipCurrentVersion).toHaveBeenCalledTimes(1);

    await press("今すぐ更新");
    expect(updater.downloadAndInstall).toHaveBeenCalledTimes(1);

    await press(CLOSE);
    expect(updater.dismiss).toHaveBeenCalledTimes(1);
  });

  test("downloading: 進み具合だけを出し、閉じられない", () => {
    show({ phase: "downloading", progress: 42 });

    expect(band().textContent).toContain("ダウンロード中…");
    expect(screen.getByText("42%")).toBeTruthy();
    const fill = document.body.querySelector<HTMLElement>(".updater-band__progressFill");
    expect(fill?.style.width).toBe("42%");
    expect(buttonNames()).toEqual([]);
  });

  test("installing: 閉じないでと言い、押せるものは無い", () => {
    show({ phase: "installing" });

    expect(band().textContent).toContain("更新を適用しています…");
    expect(band().textContent).toContain(
      "アプリを入れ替えています。終わるまで閉じないでください。",
    );
    expect(buttonNames()).toEqual([]);
  });

  test("ready: 再起動を選べるが、閉じられない", async () => {
    show({ phase: "ready" });

    expect(band().textContent).toContain("更新の準備ができました");
    expect(band().textContent).toContain("次に起動したときから新しいバージョンになります。");
    expect(buttonNames()).toEqual(["いま再起動"]);

    await press("いま再起動");
    expect(updater.restart).toHaveBeenCalledTimes(1);
  });

  // 入替は済んでいるので、開き直せば新しい版になる。押せたのに何も起きないと、壊れたと読まれる
  test("ready: 再起動に失敗したら、終了して開き直せばよいと言う", async () => {
    updater.restart.mockRejectedValueOnce(new Error("relaunch denied"));
    show({ phase: "ready" });

    await press("いま再起動");
    expect(band().textContent).toContain("「いま再起動」を実行できませんでした。");
    expect(band().textContent).toContain(
      "アプリを終了してから、もう一度起動してください。次に起動したときから新しいバージョンになります。",
    );
  });
});

describe("失敗", () => {
  test("取得の失敗は、アプリはそのまま使えると言う", () => {
    show({ phase: "error", failure: { stage: "download", detail: "network down" } });

    expect(band().textContent).toContain("更新を取得できませんでした");
    expect(band().textContent).toContain(
      "通信を確認して、もう一度お試しください。アプリはそのまま使えます。",
    );
    expect(band().className).toContain("notice-band--warning");
    expect(screen.queryByText(/network down/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "詳細" }));
    expect(screen.getByText(/network down/)).toBeTruthy();
  });

  test("入替の失敗は、閉じる前に入れ直すよう言う", () => {
    show({ phase: "error", failure: { stage: "install", detail: "swap failed" } });

    expect(band().textContent).toContain("更新を適用できませんでした");
    expect(band().textContent).toContain(
      "このまま終了すると起動できなくなることがあります。閉じる前に、配布元から最新版を入れ直してください。",
    );
    expect(band().className).toContain("notice-band--fatal");
    fireEvent.click(screen.getByRole("button", { name: "詳細" }));
    expect(screen.getByText(/swap failed/)).toBeTruthy();
  });

  test("閉じられる", () => {
    show({ phase: "error", failure: { stage: "download", detail: "x" } });

    fireEvent.click(screen.getByRole("button", { name: CLOSE }));
    expect(updater.dismiss).toHaveBeenCalledTimes(1);
  });
});

test("帯は document.body へ出し、背後を止めると名乗らない", () => {
  const { container } = render(<div id="host" />);
  updater.status = { phase: "ready" };
  render(<UpdaterScreen />, { container: container.querySelector("#host") as HTMLElement });

  expect(container.querySelector(".updater-band")).toBeNull();
  const layer = document.body.querySelector(".updater-band")!;
  expect(layer.parentElement).toBe(document.body);
  expect(layer.getAttribute("aria-modal")).toBeNull();
  expect(band().getAttribute("role")).toBe("status");
});

// 作業画面とモーダルは、帯のぶん下へ始まる。置かないと帯が覆い、残すと隙間が空く
test("帯が出ている間だけ、帯の高さを置く", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(34);
  const height = () => document.documentElement.style.getPropertyValue("--update-band-h");
  const { rerender } = render(<UpdaterScreen />);
  expect(height()).toBe("");

  updater.status = { phase: "ready" };
  rerender(<UpdaterScreen />);
  expect(height()).toBe("34px");

  updater.status = { phase: "idle" };
  rerender(<UpdaterScreen />);
  expect(height()).toBe("");
  vi.restoreAllMocks();
});
