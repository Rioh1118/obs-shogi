// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NoticeBand from "../NoticeBand";

/**
 * 残る知らせの1行。1行に省いても、全部を読む手段と、次にすることが残る。
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BODY = "1つ目の理由。\n2つ目の理由。";

function show(props: Partial<React.ComponentProps<typeof NoticeBand>> = {}) {
  const onDismiss = vi.fn();
  render(
    <NoticeBand tier="danger" title="エンジンを起動できません" onDismiss={onDismiss} {...props} />,
  );
  return { onDismiss };
}

const details = () => screen.getByRole("button", { name: "詳細" });

describe("本文", () => {
  it("1行目だけを見せ、全部は題に持つ", () => {
    show({ body: BODY });

    expect(screen.getByTitle("1つ目の理由。 2つ目の理由。", { exact: false }).textContent).toBe(
      "1つ目の理由。",
    );
  });

  it("「詳細」を押すと全部が開き、もう一度押すと閉じる", async () => {
    show({ body: BODY });
    expect(details().getAttribute("aria-expanded")).toBe("false");

    await act(async () => details().click());
    expect(details().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(details().getAttribute("aria-controls")!)?.textContent).toBe(
      BODY,
    );

    await act(async () => details().click());
    expect(document.getElementById(details().getAttribute("aria-controls")!)).toBeNull();
  });

  it("本文が無ければ「詳細」を出さない", () => {
    show();

    expect(screen.queryByRole("button", { name: "詳細" })).toBeNull();
  });
});

describe("動作", () => {
  it("押すと走る", async () => {
    const run = vi.fn();
    show({ actions: [{ label: "設定を開く", run }] });

    await act(async () => screen.getByRole("button", { name: "設定を開く" }).click());

    expect(run).toHaveBeenCalledOnce();
  });

  it("失敗したら、同じ行の下に理由を出す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({
      actions: [
        {
          label: "再試行",
          run: () => Promise.reject(new Error("boom")),
          failureBody: "もう一度お試しください。",
        },
      ],
    });

    await act(async () => screen.getByRole("button", { name: "再試行" }).click());

    expect(
      await screen.findByText("「再試行」を実行できませんでした。 もう一度お試しください。"),
    ).toBeTruthy();
  });

  it("走っている間は busy と名乗り、押せなくはしない", async () => {
    show({ actions: [{ label: "再試行", run: () => new Promise<void>(() => {}) }] });
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "再試行" });

    await act(async () => button.click());

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(false);
  });
});

describe("そのほか", () => {
  it("件数は渡したときだけ出す", () => {
    show({ count: 3 });

    expect(screen.getByText("3件")).toBeTruthy();
  });

  it("閉じるボタンは、何を閉じるかを名乗る", async () => {
    const { onDismiss } = show();

    await act(async () =>
      screen.getByRole("button", { name: "「エンジンを起動できません」を閉じる" }).click(),
    );

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each([
    ["info", "status"],
    ["warning", "status"],
    ["danger", "alert"],
    ["fatal", "alert"],
  ] as const)("%s は %s を名乗る", (tier, role) => {
    show({ tier });

    expect(screen.getByRole(role).textContent).toContain("エンジンを起動できません");
  });
});
