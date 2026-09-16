import { useMemo } from "react";
import { DEFAULT_GAME_RULES } from "@/entities/game";
import type { RulingAdapter } from "@/entities/game-session";
import { createRulingAdapter } from "../lib/rulingAdapter";

/**
 * 対局の進行へ渡す裁定器。
 *
 * **ルール（持将棋の規則・最大手数）を持つのもここ。** `GameRules` は
 * `entities/game` の型なので、対局の進行に持たせると互いを読み合う組ができる。
 * 利用者が選べるようにする口はまだ無いので、いまは既定値を使う
 * （→ `docs/spec/features/game-play.md` の「いま埋まっていない穴」）。
 *
 * **`GameSessionProvider` と同じ寿命で1つだけ作ること。** 作り直すと、
 * 中の判定器が持ち回っている棋譜が捨てられ、次の1手が根からの組み直しになる。
 */
export function useGameRuling(): RulingAdapter {
  return useMemo(() => createRulingAdapter(DEFAULT_GAME_RULES), []);
}
