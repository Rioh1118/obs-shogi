import { useMemo } from "react";
import { useFileTree } from "@/contexts/FileTreeContext";
import { useGame } from "@/contexts/GameContext";
import { Color } from "shogi.js";

function basename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function stripExt(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export type HeaderCenterInfo = {
  fileLabel: string;
  fileTitle: string;
  senteName: string | null;
  goteName: string | null;
  isPlayersShown: boolean;

  hasBadges: boolean;
  turnGlyph: "☗" | "☖";
  turnText: "先手番" | "後手番";
  tesuuText: string;
  totalText: string;

  tooltip: string;
};

export function useHeaderCenterInfo(hasFile: boolean): HeaderCenterInfo {
  const { selectedNode, jkfData } = useFileTree();
  const { state, getTotalMoves } = useGame();

  return useMemo(() => {
    const selectedFilePath =
      selectedNode && !selectedNode.isDirectory ? selectedNode.path : null;

    const fileLabel = !hasFile
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
    const isPlayersShown = hasFile && Boolean(senteName || goteName);

    // バッジ（手番・手数）
    const loaded = hasFile && !!state.jkfPlayer;

    let turn = Color.Black;
    let tesuu = 0;

    if (loaded && state.jkfPlayer) {
      try {
        turn = state.jkfPlayer.shogi.turn;
      } catch {
        turn = Color.Black;
      }
      tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu ?? 0;
    }

    const total = loaded ? getTotalMoves() : 0;

    const isSenteTurn = turn === Color.Black;
    const turnGlyph = isSenteTurn ? "☗" : "☖";
    const turnText = isSenteTurn ? "先手番" : "後手番";

    const tesuuText = loaded ? `${tesuu}手目` : "";
    const totalText = loaded ? `${tesuu}/${total}` : "";

    const playersTooltip = !hasFile
      ? "ファイル未選択"
      : !isPlayersShown
        ? "棋譜表示中"
        : `先手 ${senteName ?? "（不明）"} / 後手 ${goteName ?? "（不明）"}`;

    const tooltip = hasFile
      ? `${fileLabel} — ${playersTooltip}${loaded ? ` — ${turnText} ${totalText}` : ""}`
      : "ファイル未選択";

    return {
      fileLabel,
      fileTitle,
      senteName,
      goteName,
      isPlayersShown,
      hasBadges: loaded,
      turnGlyph,
      turnText,
      tesuuText,
      totalText,
      tooltip,
    };
  }, [
    hasFile,
    selectedNode,
    jkfData,
    state.jkfPlayer,
    state.cursor,
    getTotalMoves,
  ]);
}
