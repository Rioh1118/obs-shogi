import type { ReactNode } from "react";
import { GameMoveBridge, useGameMoveGate } from "@/features/game-move";
import { GamePersistenceGate } from "./GamePersistenceGate";

/**
 * 対局中の着手を通す門を、盤へ渡す。
 *
 * **`GameSessionProvider` の内側に置くこと。** 門は走っている対局を見て
 * 「Rust が採ったか」を決めるので、対局を知らない位置では組めない。
 *
 * 保存先の器（`GamePersistenceGate`）と分けてあるのは、**盤だけを立てる場所に
 * 対局を持ち込まないため** —— 門を渡さなければ盤は素通しで指せる。
 */
export function GameMoveGate({ children }: { children: ReactNode }) {
  const moveGate = useGameMoveGate();

  return (
    <GamePersistenceGate moveGate={moveGate}>
      {/* **盤の内側に居る。** エンジンが決めた手を積むので `useGame` が要る */}
      <GameMoveBridge />
      {children}
    </GamePersistenceGate>
  );
}
