// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * ワークスペースを選ぶボタン。選べたときだけ呼び手へ返し、自分では画面を移動しない。
 *
 * 選ばずに閉じたピッカーで `onChosen` が呼ばれると、置いた先のページは
 * 何も選ばれていないのに `/app` へ進む。
 */

const config = vi.hoisted(() => ({
  chooseRootDir: vi.fn<(opts?: { force?: boolean }) => Promise<string | null>>(),
}));

vi.mock("@/entities/app-config", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: () => config as unknown as ReturnType<typeof actual.useAppConfig>,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});

const { default: ChooseWorkspaceButton } = await import("../ChooseWorkspaceButton");

beforeEach(() => {
  config.chooseRootDir.mockReset();
});

afterEach(() => {
  cleanup();
});

async function press() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
  });
}

test("押すと、今の設定があってもピッカーを開く", async () => {
  config.chooseRootDir.mockResolvedValue(null);
  render(<ChooseWorkspaceButton onChosen={vi.fn()} />);

  await press();

  expect(config.chooseRootDir).toHaveBeenCalledTimes(1);
  expect(config.chooseRootDir).toHaveBeenCalledWith({ force: true });
});

test("選んだフォルダを呼び手へ返す", async () => {
  config.chooseRootDir.mockResolvedValue("/ws/new");
  const onChosen = vi.fn();
  render(<ChooseWorkspaceButton onChosen={onChosen} />);

  await press();

  expect(onChosen).toHaveBeenCalledTimes(1);
  expect(onChosen).toHaveBeenCalledWith("/ws/new");
});

test("選ばずに閉じたら呼び手へ返さない", async () => {
  config.chooseRootDir.mockResolvedValue(null);
  const onChosen = vi.fn();
  render(<ChooseWorkspaceButton onChosen={onChosen} />);

  await press();

  expect(onChosen).not.toHaveBeenCalled();
});
