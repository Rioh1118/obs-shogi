import { advanceWithPlan, planByTe } from "@/entities/kifu/lib/advanceWithPlan";
import { truncateFrom, type ForkPointer, type PlannedCursor } from "@/entities/kifu/model/cursor";
import type { JKFPlayer } from "json-kifu-format";

/** 棋譜ストリームの1行。`te` 手目に指した手と、同じ手数で選べる分岐 */
export type StreamRow = {
  te: number;
  /** 開始局面の行だけが `"none"` */
  side: "sente" | "gote" | "none";
  /** この行が降りた線の手。変化を選んでいれば変化の手 */
  text: string;
  commentCount: number;

  /** 同じ手数の本譜の手。分岐メニューの「本譜」に出す */
  mainText: string;
  /** 同じ手数の変化の手。添字が `forkIndex` */
  forkTexts: string[];
  forkCount: number;
  /** この行が実際に降りた変化。本譜なら null */
  selectedForkIndex: number | null;

  /** 盤のカーソルがこの行にある */
  isActive: boolean;
  /** この行より前に選んだ変化（`te` 未満）。入れ替えと削除のクエリに渡す */
  branchForkPointers: ForkPointer[];
};

/**
 * 棋譜ストリームの行を、カーソルの計画どおりに降りながら末尾まで組む。
 *
 * `player` を末尾まで進めるが、棋譜自体は書き換えない（`inputMove` を呼ばない）。
 * 呼び出し側はこの前提で棋譜を複製せずに渡している。
 *
 * これはレンダ中に走る。壊れた計画は `advanceWithPlan` が捨てるので投げないが、
 * 盤上で再生できない手を含む棋譜（正規化に失敗して未正規化のまま開いたもの）では
 * 再生そのものが投げる。**唯一の呼び出し側の `KifuStreamList` はまだ拾っていない。**
 * 拾うだけだと読める手まで消えるので、復帰導線と一緒に直す（TODO(#277)）。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき（`advanceWithPlan` が投げる）
 */
export function buildStreamRowsFromCursor(
  player: JKFPlayer,
  cursor: PlannedCursor | null,
): StreamRow[] {
  const plan = planByTe(cursor?.forkPointers);

  const rows: StreamRow[] = [];
  const currentTesuu = cursor?.tesuu ?? 0;

  const mf0 = player.currentStream[0];
  rows.push({
    te: 0,
    side: "none",
    text: "開始局面",
    commentCount: (mf0?.comments ?? []).length,
    mainText: "開始局面",
    forkTexts: [],
    forkCount: 0,
    selectedForkIndex: null,
    isActive: currentTesuu === 0,
    branchForkPointers: [],
  });

  let safety = 100000;
  while (safety-- > 0) {
    const te = player.tesuu + 1;
    if (!player.currentStream[te]) break;

    const forkTexts = player.getReadableForkKifu?.() ?? [];
    const mainText = (() => {
      const ok = player.forward();
      if (!ok) return "";
      const s = player.getReadableKifu?.() ?? "";
      player.backward();
      return s;
    })();

    // 行が「選ばれている」と言う値は、この走査が実際に降りたものでなければならない。
    // 計画をそのまま載せると、降りられずに線を進んだのにバッジは「変化1」でメニューの ✓ は本譜、
    // という食い違った画面になり、`branchIndexFromRow` が使えない値を投げる。
    const { moved, forkIndex: selectedForkIndex } = advanceWithPlan(player, plan);
    if (!moved) break;

    const mf = player.currentStream[te];
    const mv = mf?.move;

    const side =
      mv?.color === 0 ? "sente" : mv?.color === 1 ? "gote" : te % 2 === 1 ? "sente" : "gote";

    const text = player.getReadableKifu?.() ?? "";

    const branchForkPointers = truncateFrom(cursor?.forkPointers ?? [], te);
    rows.push({
      te,
      side,
      text,
      commentCount: (mf?.comments ?? []).length,
      mainText,
      forkTexts,
      forkCount: forkTexts.length,
      selectedForkIndex,
      isActive: te === currentTesuu,
      branchForkPointers,
    });
  }

  return rows;
}
