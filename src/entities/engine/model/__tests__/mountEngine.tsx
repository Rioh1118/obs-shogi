import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { EngineProvider } from "../provider";
import { useEngine } from "../useEngine";
import type { EngineNotReadyReason, EnginePhase, EngineRuntimeConfig } from "../types";
import type { EngineInfo } from "@/entities/engine/api/rust-types";

/**
 * `EngineProvider` を立てて、**commit された理由を順に集める**足場。
 *
 * 2本のテストが同じ形を要る（差し替えの深さだけが違う——`api/initializer` を差すか、
 * `api/tauri` を差して本物の初期化器を通すか）ので、ここに1つだけ置く。
 * `vi.mock` は巻き上げなので各テストに残す。
 */
export const info = { name: "test-engine", author: "t", options: [] } satisfies EngineInfo;

export const runtime = (options: Record<string, string> = {}): EngineRuntimeConfig => ({
  enginePath: "/e",
  workDir: "/w",
  evalDir: "/v",
  bookDir: null,
  bookFile: null,
  options,
});

/**
 * 落ち着くまで進める。**実時計を待たない。**
 *
 * `EngineProvider` と `api/initializer` はタイマーを1つも持たないので、動くのは
 * 「promise が解決 → effect が走る → dispatch → 再描画 → また effect」の連鎖だけ。
 * 固定の sleep で待つと、**混んだ機械では連鎖が終わる前に assert に着く**
 * ——コードを1行も触っていないのに落ちる（`entities/analysis` の `waits.ts` が
 * 同じ形を予告している）。マクロタスクを決まった回数回して排出する。
 *
 * **回数は連鎖の深さより十分に多く取る。** 足りなければ落ちるが、多すぎても遅くならない
 * （待つのは空のタスクキューなので、実時間はほぼ0）。
 */
const DRAIN_TURNS = 24;

export async function drain() {
  for (let i = 0; i < DRAIN_TURNS; i++) {
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  }
}

export type EngineView = {
  reasons: (EngineNotReadyReason | null)[];
  /** commit された `phase` を順に。**理由では割れない窓を見るときだけ使う。** */
  phases: EnginePhase[];
  setRuntime(desired: EngineRuntimeConfig | null): Promise<void>;
  settle(): Promise<void>;
};

export function mountEngine(initial: EngineRuntimeConfig | null): EngineView {
  const seen: (EngineNotReadyReason | null)[] = [];
  const phases: EnginePhase[] = [];

  function Probe() {
    const { notReadyReason, state } = useEngine();
    useEffect(() => {
      seen.push(notReadyReason);
      phases.push(state.phase);
    });
    return null;
  }

  const tree = (desired: EngineRuntimeConfig | null) => (
    <EngineProvider desiredRuntime={desired}>
      <Probe />
    </EngineProvider>
  );

  const utils = render(tree(initial));
  return {
    reasons: seen,
    phases,
    async setRuntime(desired) {
      await act(async () => {
        utils.rerender(tree(desired));
      });
    },
    settle: drain,
  };
}
