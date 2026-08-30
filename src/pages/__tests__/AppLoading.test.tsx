// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

/**
 * `error` が立っている間の `/` と `/app` の往復を止める。
 *
 * `Navigate` は effect の中で `navigate()` を呼ぶので、往復は型でもレンダでも
 * 捕まらない。実際に踏んだ形は、起動エラーの画面に `FolderSelect` を置いたこと。
 * あちらは `config.root_dir` があれば `/app` へ飛び、`RequireRootDir` は `error` を
 * 見て `/` へ戻すので止まらなくなった（React が「Maximum update depth exceeded」で
 * ツリーごと投げ、境界が無いので**真っ白なウィンドウ**になる）。
 *
 * **`error` と `config` は同時に立つ。** `configReducer` の `error` は `config` を
 * 残すので、更新の失敗（→ #249）でこの組み合わせになる。
 */

const state = {
  config: { root_dir: "/ws", ai_root: null } as { root_dir: string | null; ai_root: null } | null,
  isLoading: false,
  error: null as string | null,
};

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ ...state, chooseRootDir: vi.fn() }),
}));

vi.mock("@/widgets/boot-splash/ui/BootSplash", () => ({ default: () => <div>splash</div> }));

const { default: AppLoading } = await import("../AppLoading");
const { RequireRootDir } = await import("@/app/routing/guards/RequireRootDir");

/** 通った pathname を数える。往復すると同じ値が何度も積まれる */
const visited: string[] = [];
function Spy() {
  const { pathname } = useLocation();
  visited.push(pathname);
  if (visited.length > 20) throw new Error(`往復している: ${visited.slice(0, 8).join(" -> ")}`);
  return null;
}

afterEach(() => {
  cleanup();
  visited.length = 0;
});

function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Spy />
      <Routes>
        <Route path="/" element={<AppLoading />} />
        <Route
          path="/app"
          element={
            <RequireRootDir>
              <div>app</div>
            </RequireRootDir>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("起動エラーの画面", () => {
  it("設定の更新が落ちたあとでも、/ と /app を往復しない", () => {
    state.error = "last_preset_id の保存に失敗しました";
    state.config = { root_dir: "/ws", ai_root: null };

    expect(() => mountAt("/app")).not.toThrow();
  });

  it("行き止まりにしない。選び直す手段を出す", () => {
    state.error = "設定の読み込みに失敗しました";
    state.config = null;

    mountAt("/");

    expect(screen.getByRole("alert").textContent).toContain("設定の読み込みに失敗しました");
    expect(screen.getByRole("button")).toBeTruthy();
  });
});
