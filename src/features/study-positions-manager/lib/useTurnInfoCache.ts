import { useCallback, useRef } from "react";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";

export interface TurnInfo {
  turnText: string | null;
  tesuu: number;
}

function parseTesuu(sfen: string): number {
  const tokens = sfen.trim().split(/\s+/);
  return tokens.length >= 4 ? parseInt(tokens[3], 10) || 0 : 0;
}

export function useTurnInfoCache() {
  const cache = useRef(new Map<string, number>());

  return useCallback((sfen: string): TurnInfo => {
    const cached = cache.current.get(sfen);
    if (cached !== undefined) {
      return {
        turnText: cached === 0 ? "先手" : "後手",
        tesuu: parseTesuu(sfen),
      };
    }

    const pd = buildPreviewDataFromSfen(sfen);
    if (pd) {
      cache.current.set(sfen, pd.turn);
      return {
        turnText: pd.turn === 0 ? "先手" : "後手",
        tesuu: parseTesuu(sfen),
      };
    }

    return { turnText: null, tesuu: 0 };
  }, []);
}
