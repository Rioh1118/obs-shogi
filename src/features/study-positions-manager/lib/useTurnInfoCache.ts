import { useCallback, useRef } from "react";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";

type TurnInfo = {
  turnShortText: string | null;
  tesuu: number;
};

function parseTesuu(sfen: string): number {
  const tokens = sfen.trim().split(/\s+/);
  return tokens.length >= 4 ? parseInt(tokens[3], 10) || 0 : 0;
}

/**
 * SFEN から一覧の行に出す手番と手数を返す関数を作る。
 *
 * 手番は盤を組んで SFEN を確かめてから出すので重い。一覧は選択が動くたびに全行を描き直すため、
 * 手番だけを SFEN ごとに覚える。組めない SFEN は手番を `null` にする。
 */
export function useTurnInfoCache() {
  const cache = useRef(new Map<string, number>());

  return useCallback((sfen: string): TurnInfo => {
    const cached = cache.current.get(sfen);
    if (cached !== undefined) {
      return {
        turnShortText: cached === 0 ? "先手" : "後手",
        tesuu: parseTesuu(sfen),
      };
    }

    const pd = buildPreviewDataFromSfen(sfen);
    if (pd) {
      cache.current.set(sfen, pd.turn);
      return {
        turnShortText: pd.turn === 0 ? "先手" : "後手",
        tesuu: parseTesuu(sfen),
      };
    }

    return { turnShortText: null, tesuu: 0 };
  }, []);
}
