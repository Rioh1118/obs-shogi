import { useMemo } from "react";
import { turnText } from "@/shared/lib/turn";
import { useGame } from "@/entities/game";
import { playerNames } from "@/entities/kifu/lib/playerNames";

export type HeaderCenterInfo = {
  /** 棋譜が盤に載っているか */
  hasKifu: boolean;

  fileLabel: string;
  fileTitle: string;

  /** 見出しの題に出す1行。対局者・手番・手数は、画面では駒台と棋譜の見出しが出す */
  tooltip: string;
};

function basename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function stripExt(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * 見出しの、いま開いている棋譜の表示を組む。
 *
 * 棋譜が載っているかは、呼び手から受けずに自分で game に訊く。真偽値で受け取ると、
 * 同じ問いに `hasKifu` と prop の2つの綴りができる。
 *
 * 出どころは全部 game で、ツリーの選択は見ない（2つの違いは `loadedAbsPath` の doc）。
 * ツリー側を出どころにすると、盤に載せられなかった棋譜でも見出しだけが入れ替わり、
 * 盤には前の棋譜が残ったまま「新しい棋譜を見ている」と読める画面になる。
 */
export function useHeaderCenterInfo(): HeaderCenterInfo {
  const { state, view } = useGame();
  const { hasKifu, currentTurn, player, totalMoves } = view;
  const { loadedAbsPath, jkf, cursor } = state;

  return useMemo(() => {
    if (!hasKifu) {
      const none = "ファイル未選択";
      return { hasKifu, fileLabel: none, fileTitle: loadedAbsPath ?? none, tooltip: none };
    }

    const fileLabel = loadedAbsPath ? stripExt(basename(loadedAbsPath)) : "棋譜";

    // 欄名と欠けの判定は `playerNames` が持つ
    const { sente, gote } = playerNames(jkf);
    const players =
      sente || gote ? `先手 ${sente ?? "（不明）"} / 後手 ${gote ?? "（不明）"}` : "棋譜表示中";

    const tesuu = player ? (cursor?.tesuu ?? player.tesuu) : 0;

    return {
      hasKifu,
      fileLabel,
      fileTitle: loadedAbsPath ?? fileLabel,
      tooltip: `${fileLabel} — ${players} — ${turnText(currentTurn)} ${tesuu}/${totalMoves}`,
    };
  }, [hasKifu, loadedAbsPath, jkf, player, currentTurn, totalMoves, cursor]);
}
