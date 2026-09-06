import { useMemo } from "react";
import { Color } from "shogi.js";
import { turnGlyph, type TurnGlyph } from "@/shared/lib/turn";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";

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

  hasBadges: boolean;
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
 */
export function useHeaderCenterInfo(): HeaderCenterInfo {
  const { selectedNode, jkfData } = useFileTree();
  const { state, view, getTotalMoves } = useGame();
  const hasKifu = view.hasKifu;

  return useMemo(() => {
    const selectedFilePath = selectedNode && !selectedNode.isDirectory ? selectedNode.path : null;

    const fileLabel = !hasKifu
      ? "ファイル未選択"
      : selectedFilePath
        ? stripExt(basename(selectedFilePath))
        : "棋譜";

    const fileTitle = selectedFilePath ?? fileLabel;

    // 対局者
    const header = jkfData?.header ?? {};
    const sente = (header["先手"] ?? "").trim();
    const gote = (header["後手"] ?? "").trim();
    const senteName = sente.length ? sente : null;
    const goteName = gote.length ? gote : null;
    const isPlayersShown = hasKifu && Boolean(senteName || goteName);

    // バッジ（手番・手数）
    const loaded = hasKifu;

    let turn = Color.Black;
    let tesuu = 0;

    if (loaded && view.player) {
      try {
        turn = view.player.shogi.turn;
      } catch {
        turn = Color.Black;
      }
      tesuu = state.cursor?.tesuu ?? view.player.tesuu ?? 0;
    }

    const total = loaded ? getTotalMoves() : 0;

    const isSenteTurn = turn === Color.Black;
    const glyph = turnGlyph(turn);
    const turnText = isSenteTurn ? "先手番" : "後手番";

    const tesuuText = loaded ? `${tesuu}手目` : "";
    const totalText = loaded ? `${tesuu}/${total}` : "";

    const playersTooltip = !hasKifu
      ? "ファイル未選択"
      : !isPlayersShown
        ? "棋譜表示中"
        : `先手 ${senteName ?? "（不明）"} / 後手 ${goteName ?? "（不明）"}`;

    const tooltip = hasKifu
      ? `${fileLabel} — ${playersTooltip}${loaded ? ` — ${turnText} ${totalText}` : ""}`
      : "ファイル未選択";

    return {
      hasKifu,
      fileLabel,
      fileTitle,
      senteName,
      goteName,
      isPlayersShown,
      hasBadges: loaded,
      turnGlyph: glyph,
      turnText,
      tesuuText,
      totalText,
      tooltip,
    };
  }, [hasKifu, selectedNode, jkfData, view.player, state.cursor, getTotalMoves]);
}
