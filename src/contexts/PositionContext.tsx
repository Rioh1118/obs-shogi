import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
} from "react";
import { useGame } from "./GameContext";
import { setPositionFromSfen } from "@/commands/engine/core";

interface PositionContextType {
  currentSfen: string | null;
  syncPosition: () => Promise<void>;
  isPositionSynced: boolean;
  syncError: string | null;
}

const PositionContext = createContext<PositionContextType | null>(null);

export const PositionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { state: gameState } = useGame();
  const [isPositionSynced, setIsPositionSynced] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  // ✅ GameContextから現在のSFENを取得
  const getCurrentSfen = useCallback((): string | null => {
    try {
      if (!gameState.jkfPlayer?.shogi) {
        return null;
      }

      // 現在の手数でSFEN生成
      const sfen = gameState.jkfPlayer.shogi.toSFENString(
        gameState.jkfPlayer.tesuu || 1,
      );
      console.log(
        `📋 [POSITION] Current SFEN (手数${gameState.jkfPlayer.tesuu}):`,
        sfen,
      );
      return sfen;
    } catch (error) {
      console.error("❌ [POSITION] Error getting SFEN:", error);
      return null;
    }
  }, [gameState.jkfPlayer]);

  // ✅ エンジンに局面を同期
  const syncPosition = useCallback(async () => {
    try {
      setSyncError(null);
      const sfen = getCurrentSfen();

      if (!sfen) {
        console.log("⚠️ [POSITION] No SFEN available, skipping sync");
        return;
      }

      console.log("🔄 [POSITION] Syncing position to engine:", sfen);
      await setPositionFromSfen(sfen);

      setIsPositionSynced(true);
      console.log("✅ [POSITION] Position synced successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Position sync failed";
      console.error("❌ [POSITION] Sync failed:", error);
      setSyncError(errorMessage);
      setIsPositionSynced(false);
    }
  }, [getCurrentSfen]);

  // ✅ GameContextの変化を監視して自動同期
  useEffect(() => {
    if (!gameState.jkfPlayer) {
      console.log("⚠️ [POSITION] No JKFPlayer, skipping auto-sync");
      return;
    }

    console.log("🎯 [POSITION] Game state changed, auto-syncing position...");
    syncPosition();
  }, [gameState.jkfPlayer, syncPosition]);

  const currentSfen = getCurrentSfen();

  const value = React.useMemo(
    () => ({
      currentSfen,
      syncPosition,
      isPositionSynced,
      syncError,
    }),
    [currentSfen, syncPosition, isPositionSynced, syncError],
  );

  return (
    <PositionContext.Provider value={value}>
      {children}
    </PositionContext.Provider>
  );
};

export const usePosition = () => {
  const context = useContext(PositionContext);
  if (!context) {
    throw new Error("usePosition must be used within PositionProvider");
  }
  return context;
};
