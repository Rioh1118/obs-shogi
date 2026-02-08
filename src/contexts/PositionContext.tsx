import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useGame } from "./GameContext";
import { useEngine } from "./EngineContext";
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
  const { isReady } = useEngine();

  const [isPositionSynced, setIsPositionSynced] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  // pending と lastSent で「readyになるまで待つ」「二重送信しない」
  const pendingSfenRef = useRef<string | null>(null);
  const lastSentSfenRef = useRef<string | null>(null);

  const isNotInitializedError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      msg.includes("NotInitialized") || msg.includes("Engine not initialized")
    );
  };

  // ✅ GameContextから現在のSFENを取得（今の意図をそのまま）
  // 重要：jkfPlayerが同一参照でも、中身は変わるので毎回計算でOK
  const getCurrentSfen = useCallback((): string | null => {
    try {
      if (!gameState.jkfPlayer?.shogi) return null;

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
  }, [gameState.jkfPlayer, gameState.cursor]); // ★ cursor変化で再計算できるように

  // ✅ エンジンに局面を同期（ready前は送らずpendingへ）
  const syncPosition = useCallback(async () => {
    setSyncError(null);

    const sfen = getCurrentSfen();
    if (!sfen) {
      console.log("⚠️ [POSITION] No SFEN available, skipping sync");
      setIsPositionSynced(false);
      pendingSfenRef.current = null;
      lastSentSfenRef.current = null;
      return;
    }

    // ready前は送らない（NotInitialized 根絶）
    if (!isReady) {
      pendingSfenRef.current = sfen;
      setIsPositionSynced(false);
      return;
    }

    // 同じ局面なら送らない（StrictMode / 連続effect対策）
    if (lastSentSfenRef.current === sfen) {
      setIsPositionSynced(true);
      return;
    }

    try {
      console.log("🔄 [POSITION] Syncing position to engine:", sfen);
      await setPositionFromSfen(sfen);

      lastSentSfenRef.current = sfen;
      pendingSfenRef.current = null;
      setIsPositionSynced(true);

      console.log("✅ [POSITION] Position synced successfully");
    } catch (error) {
      // 万一NotInitializedが返っても「まだreadyじゃなかった扱い」でpendingへ戻す
      if (isNotInitializedError(error)) {
        pendingSfenRef.current = sfen;
        lastSentSfenRef.current = null;
        setIsPositionSynced(false);
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Position sync failed";
      console.error("❌ [POSITION] Sync failed:", error);
      setSyncError(errorMessage);
      setIsPositionSynced(false);
    }
  }, [getCurrentSfen, isReady]);

  // ✅ 自動同期：jkfPlayer参照じゃなく「cursor変化」で追従する
  useEffect(() => {
    if (!gameState.jkfPlayer) {
      console.log("⚠️ [POSITION] No JKFPlayer, skipping auto-sync");
      setIsPositionSynced(false);
      pendingSfenRef.current = null;
      lastSentSfenRef.current = null;
      return;
    }

    console.log("🎯 [POSITION] Game cursor changed, auto-syncing position...");
    syncPosition().catch(() => {});
  }, [gameState.cursor, gameState.jkfPlayer, syncPosition]); // ★ここが肝

  // ✅ エンジンがreadyになった瞬間に pending を反映
  useEffect(() => {
    if (!isReady) return;
    if (!pendingSfenRef.current) return;

    console.log("🚀 [POSITION] Engine became ready, flushing pending SFEN");
    syncPosition().catch(() => {});
  }, [isReady, syncPosition]);

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
