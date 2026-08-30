// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import AppLoading from "@/pages/AppLoading";
import { RequireRootDir } from "../guards/RequireRootDir";

/**
 * `error` が立っている間、`/` と `/app` を往復しない。
 *
 * ここは**ルーティングの性質**なので app 層に置く。`RequireRootDir` は
 * `error` を見て `/` へ送り、`/` のページは `config.root_dir` を見て `/app` へ
 * 送る。この2つが同時に成り立つと往復が止まらず、React は
 * 「Maximum update depth exceeded」でツリーごと投げる。境界が無いので
 * 画面は**真っ白**になり、エラー文も選び直す手段も消える。
 *
 * `Navigate` は effect の中で `navigate()` を呼ぶので、この往復は型でも
 * レンダでも捕まらない。通った pathname を数えるしかない。
 *
 * **`error` と `config` は同時に立つ。** `configReducer` の `error` は `config` を
 * 残すので、更新の失敗（→ TODO(#249)）でこの組み合わせになる。
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
