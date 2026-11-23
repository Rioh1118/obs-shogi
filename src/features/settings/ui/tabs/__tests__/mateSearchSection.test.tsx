// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EnginePreset } from "@/entities/engine-presets";
import { Err, Ok } from "@/shared/lib/result";

const world = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  setMateSearchConfig: vi.fn(),
}));
vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => world) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});

const { default: MateSearchSection } = await import("../../engine-tab/MateSearchSection");

const preset = (id: string, label: string) => ({ id, label }) as EnginePreset;
const PRESETS = [preset("a", "研究用"), preset("k", "詰将棋")];
const select = () => screen.getByLabelText("詰み探索に使うプリセット") as HTMLSelectElement;
const radio = (label: string) => screen.getByRole("radio", { name: label }) as HTMLInputElement;

beforeEach(() => {
  world.config = {};
  world.setMateSearchConfig.mockReset().mockResolvedValue(Ok(undefined));
});
afterEach(cleanup);

test("選んでいなければ「指定しない」で、上限は30秒", () => {
  render(<MateSearchSection presets={PRESETS} />);
  expect([...select().options].map((o) => o.textContent)).toEqual([
    "指定しない",
    "研究用",
    "詰将棋",
  ]);
  expect(select().value).toBe("");
  expect(radio("30秒").checked).toBe(true);
});

test.each([
  ["選んでいなければ", {}, true],
  ["削除したプリセットを指していれば", { mate_preset_id: "gone" }, true],
  ["選んでいれば", { mate_preset_id: "k" }, false],
])("%s、選ぶ案内を出すか: %j → %s", (_, config, shown) => {
  world.config = config;
  render(<MateSearchSection presets={PRESETS} />);

  const note = screen.queryByText("詰将棋エンジンのプリセットを選択してください。");
  expect(note !== null).toBe(shown);
});

test("選ぶと、その欄だけを保存する。「指定しない」は null", async () => {
  world.config = { mate_preset_id: "a", mate_search_limit: "infinite" };
  render(<MateSearchSection presets={PRESETS} />);
  expect(select().value).toBe("a");
  expect(radio("無制限").checked).toBe(true);

  await act(async () => fireEvent.change(select(), { target: { value: "k" } }));
  await act(async () => fireEvent.change(select(), { target: { value: "" } }));
  await act(async () => fireEvent.click(radio("10秒")));
  expect(world.setMateSearchConfig.mock.calls).toEqual([
    [{ mate_preset_id: "k" }],
    [{ mate_preset_id: null }],
    [{ mate_search_limit: "10" }],
  ]);
});

test("削除したプリセットの ID が残っていれば「指定しない」に見せる", () => {
  world.config = { mate_preset_id: "gone" };
  render(<MateSearchSection presets={PRESETS} />);
  expect(select().value).toBe("");
});

test("保存に失敗したら理由を言い、次の保存が通れば消す", async () => {
  world.setMateSearchConfig.mockResolvedValueOnce(Err("disk full"));
  render(<MateSearchSection presets={PRESETS} />);
  await act(async () => fireEvent.change(select(), { target: { value: "k" } }));
  expect(screen.getByText(/disk full/)).toBeTruthy();
  await act(async () => fireEvent.change(select(), { target: { value: "a" } }));
  expect(screen.queryByText(/disk full/)).toBeNull();
});
