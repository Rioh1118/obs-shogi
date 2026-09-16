import type { ClocksView } from "../api/rust-types";
import type { GameSessionView } from "./types";

/**
 * 時計を持っている状態だけが持つ。**描き直す間隔はこれで決まる**
 * （`tickIntervalMs` に渡す）。
 */
export function clocksOf(view: GameSessionView): ClocksView | null {
  if (view.kind === "live") return view.clocks;
  if (view.kind === "over") return view.clocks;
  return null;
}

/**
 * 盤に出ている棋譜と、対局の棋譜が違うか。
 *
 * **対局は棋譜が入れ替わっても走り続ける**ので、別の棋譜を開いている間も
 * 対局は進む。黙って進行を出すと、いま見ている棋譜の対局に見える。
 *
 * **判定を2面が別々に組まない。** この印を出すのはヘッダの対局の行と対局タブの
 * 2つで（ADR-0011 決定2）、同じ式を2箇所に置くと #538（改名での誤検知）の
 * 直しが片面にだけ入る。
 *
 * **盤の側の棋譜は引数で受ける。** `entities/game` から読むと、あちらが `Side` を
 * ここから取っているので互いを読み合う組ができ、
 * `src/__tests__/crossSliceImports.test.ts` が落ちる。
 */
export function isForeignKifuSession(
  view: GameSessionView,
  loadedKifuPath: string | null,
): boolean {
  // 対局を持っていない状態には棋譜の欄が無い。印の出しようが無いので偽
  if (view.kind === "idle") return false;
  return view.kifuPath !== loadedKifuPath;
}
