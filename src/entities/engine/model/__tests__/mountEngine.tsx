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
 * **落ち着くまで進める。回数は数えない。**
 *
 * `EngineProvider` と `api/initializer` はタイマーを1つも持たないので、動くのは
 * 「promise が解決 → effect が走る → dispatch → 再描画 → また effect」の連鎖だけ。
 * だが**固定の回数で待つのは、実時計で待つのと同じ**——`act` が回す React の work loop は
 * 実時計の予算で yield するので、混んだ機械では1段が複数ターンに割れる。
 *
 * **足りない回に「別の結末になった」と読まれるのが最悪の壊れ方。** 実際に、排出が
 * 足りないと「追い越された畳みが健全なエンジンを殺した」の顔で落ちる
 * ——**下の門が守っている性質そのものの名前**で。だから**静止を観測して抜け**、止まらない回は**そう名乗って**落ちる。
 *
 * 静止の観測は commit の数。`Probe` は依存なしの effect なので、commit のたびに必ず積む。
 */
const QUIET_TURNS = 2;
const HARD_CAP = 200;

async function turn() {
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

async function drainUntilQuiet(commits: () => number) {
  for (let i = 0, quiet = 0; quiet < QUIET_TURNS; i++) {
    if (i >= HARD_CAP) {
      throw new Error(`drain: ${HARD_CAP} ターン回しても静止しない（連鎖が止まっていない）`);
    }
    const before = commits();
    await turn();
    quiet = commits() === before ? quiet + 1 : 0;
  }
}

/** 木を自分で建てるテスト用。**静止は観測できない**ので回数で回す。 */
export async function drain(turns = 8) {
  for (let i = 0; i < turns; i++) await turn();
}

export function mountEngine(initial: EngineRuntimeConfig | null) {
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
    async setRuntime(desired: EngineRuntimeConfig | null) {
      await act(async () => {
        utils.rerender(tree(desired));
      });
    },
    settle: () => drainUntilQuiet(() => seen.length),
  };
}
