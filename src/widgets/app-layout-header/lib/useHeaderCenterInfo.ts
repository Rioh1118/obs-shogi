import { useMemo } from "react";
import { Color } from "shogi.js";
import { turnGlyph, turnText as turnTextOf, type TurnGlyph } from "@/shared/lib/turn";
import { useGame } from "@/entities/game";
import { playerNames } from "@/entities/kifu/lib/playerNames";

function basename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function stripExt(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export type HeaderCenterInfo = {
  /** 棋譜が盤に載っているか。ヘッダの表示はどれもこれで分岐する */
  hasKifu: boolean;

  fileLabel: string;
  fileTitle: string;
  senteName: string | null;
  goteName: string | null;
  isPlayersShown: boolean;

  turnGlyph: TurnGlyph;
  turnText: "先手番" | "後手番";
  tesuuText: string;
  totalText: string;

  tooltip: string;
};

/**
 * ヘッダ中央の表示を組む。
 *
 * **棋譜が載っているかは自分で game に訊く。** 呼び出し側から真偽値で受け取ると、
 * 同じ問いに `hasKifu` と prop の2つの綴りができる。
 *
 * **出どころは全部 game で、ツリーの選択は見ない**（2つの違いは `loadedAbsPath` の doc）。
 * ツリー側を出どころにすると、盤に載せられなかった棋譜でも見出しだけが入れ替わり、
 * 盤には前の棋譜が残ったまま「新しい棋譜を見ている」と読める画面になる。
 */
export function useHeaderCenterInfo(): HeaderCenterInfo {
  const { state, view, getTotalMoves } = useGame();
  const hasKifu = view.hasKifu;
  const loadedAbsPath = state.loadedAbsPath;
  const jkf = state.jkf;

  return useMemo(() => {
    const fileLabel = !hasKifu
      ? "ファイル未選択"
      : loadedAbsPath
        ? stripExt(basename(loadedAbsPath))
        : "棋譜";

    const fileTitle = loadedAbsPath ?? fileLabel;

    // 対局者。欄名と欠けの判定は `playerNames` が持つ
    const { sente: senteName, gote: goteName } = playerNames(jkf);
    const isPlayersShown = hasKifu && Boolean(senteName || goteName);

    // バッジ（手番・手数）

    let turn = Color.Black;
    let tesuu = 0;

    if (hasKifu && view.player) {
      try {
        turn = view.player.shogi.turn;
      } catch {
        turn = Color.Black;
      }
      tesuu = state.cursor?.tesuu ?? view.player.tesuu ?? 0;
    }

    const total = hasKifu ? getTotalMoves() : 0;

    const glyph = turnGlyph(turn);
    const turnLine = turnTextOf(turn);

    const tesuuText = hasKifu ? `${tesuu}手目` : "";
    const totalText = hasKifu ? `${tesuu}/${total}` : "";

    // `hasKifu` が偽なら下の三項で "ファイル未選択" に落ちるので、ここでは分岐しない
    const playersTooltip = isPlayersShown
      ? `先手 ${senteName ?? "（不明）"} / 後手 ${goteName ?? "（不明）"}`
      : "棋譜表示中";

    const tooltip = hasKifu
      ? `${fileLabel} — ${playersTooltip} — ${turnLine} ${totalText}`
      : "ファイル未選択";

    return {
      hasKifu,
      fileLabel,
      fileTitle,
      senteName,
      goteName,
      isPlayersShown,
      turnGlyph: glyph,
      turnText: turnLine,
      tesuuText,
      totalText,
      tooltip,
    };
  }, [hasKifu, loadedAbsPath, jkf, view.player, state.cursor, getTotalMoves]);
}
