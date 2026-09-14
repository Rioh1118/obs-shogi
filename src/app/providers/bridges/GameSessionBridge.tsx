import type { ReactNode } from "react";
import { GameSessionProvider } from "@/entities/game-session";
import { useGameRuling } from "@/features/game-ruling";

/**
 * 対局の進行に、終局の裁定を繋ぐ。
 *
 * **判定を `entities/game-session` の中から呼ばない。** あちらは `Side` を
 * `entities/game` に渡している側なので、読み返すと互いを読み合う組ができて
 * `src/__tests__/crossSliceImports.test.ts` が落ちる。`AnalysisBridge` が
 * `PositionSyncAdapter` を渡しているのと同じ形で、ここから注入する。
 */
export function GameSessionBridge({ children }: { children: ReactNode }) {
  const ruling = useGameRuling();

  return <GameSessionProvider ruling={ruling}>{children}</GameSessionProvider>;
}
