// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UpdaterStatus } from "@/entities/updater";

/**
 * 更新のカード。段ごとの見出し、押せるもの、閉じられるかを見る。
 * 表は `docs/spec/screens/system-dialogs.md` の「更新」。
 *
 * 取得と入替の最中に閉じられると、進み具合を見る面が消える。
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

function card() {
  return screen.getByRole("status", { name: "アップデート" });
}

function buttonNames(): string[] {
  return screen
    .queryAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

describe("描かない段", () => {
  test.each(["idle", "checking"] as const)("%s では何も描かない", (phase) => {
    show({ phase });

    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.querySelector(".updater-overlay")).toBeNull();
  });
});

describe("段ごとの見出しと押せるもの", () => {
  test("available: 版を出し、飛ばすか更新するかを選べて、閉じられる", () => {
    show({ phase: "available", version: "1.2.3" });

    expect(card().textContent).toContain("新しいバージョンが利用可能");
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(buttonNames()).toEqual(["閉じる", "この版は飛ばす", "今すぐ更新"]);

    fireEvent.click(screen.getByRole("button", { name: "この版は飛ばす" }));
    expect(updater.skipCurrentVersion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));
    expect(updater.downloadAndInstall).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(updater.dismiss).toHaveBeenCalledTimes(1);
  });

  test("downloading: 進み具合だけを出し、閉じられない", () => {
    show({ phase: "downloading", progress: 42 });

    expect(card().textContent).toContain("ダウンロード中…");
    expect(screen.getByText("42%")).toBeTruthy();
    const fill = document.body.querySelector<HTMLElement>(".updater-card__progress-fill");
    expect(fill?.style.width).toBe("42%");
    expect(buttonNames()).toEqual([]);
  });

  test("installing: 閉じないでと言い、押せるものは無い", () => {
    show({ phase: "installing" });

    expect(card().textContent).toContain("更新を適用しています…");
    expect(card().textContent).toContain(
      "アプリを入れ替えています。終わるまで閉じないでください。",
    );
    expect(buttonNames()).toEqual([]);
  });

  test("ready: 再起動を選べるが、閉じられない", () => {
    show({ phase: "ready" });

    expect(card().textContent).toContain("更新の準備ができました");
    expect(card().textContent).toContain("次に起動したときから新しいバージョンになります。");
    expect(buttonNames()).toEqual(["いま再起動"]);

    fireEvent.click(screen.getByRole("button", { name: "いま再起動" }));
    expect(updater.restart).toHaveBeenCalledTimes(1);
  });
});

describe("失敗", () => {
  test("取得の失敗は、アプリはそのまま使えると言う", () => {
    show({ phase: "error", failure: { stage: "download", detail: "network down" } });

    expect(card().textContent).toContain("更新を取得できませんでした");
    expect(card().textContent).toContain(
      "通信を確認して、もう一度お試しください。アプリはそのまま使えます。",
    );
    expect(screen.getByText("network down")).toBeTruthy();
  });

  test("入替の失敗は、閉じる前に入れ直すよう言う", () => {
    show({ phase: "error", failure: { stage: "install", detail: "swap failed" } });

    expect(card().textContent).toContain("更新を適用できませんでした");
    expect(card().textContent).toContain(
      "このまま終了すると起動できなくなることがあります。閉じる前に、配布元から最新版を入れ直してください。",
    );
    expect(screen.getByText("swap failed")).toBeTruthy();
  });

  test("✕と「閉じる」のどちらでも閉じられる", () => {
    show({ phase: "error", failure: { stage: "download", detail: "x" } });

    const closers = screen.getAllByRole("button", { name: "閉じる" });
    expect(closers).toHaveLength(2);

    fireEvent.click(closers[0]);
    fireEvent.click(closers[1]);
    expect(updater.dismiss).toHaveBeenCalledTimes(2);
  });
});

test("カードは document.body へ出し、背後を止めると名乗らない", () => {
  const { container } = render(<div id="host" />);
  updater.status = { phase: "ready" };
  render(<UpdaterScreen />, { container: container.querySelector("#host") as HTMLElement });

  expect(container.querySelector(".updater-overlay")).toBeNull();
  expect(card().parentElement).toBe(document.body);
  expect(card().getAttribute("aria-modal")).toBeNull();
  expect(card().getAttribute("aria-live")).toBe("polite");
});
