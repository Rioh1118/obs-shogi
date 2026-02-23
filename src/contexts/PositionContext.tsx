import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useEngine } from "./EngineContext";
import { setPositionFromSfen } from "@/commands/engine/core";
import { useGame } from "@/entities/game";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";

interface PositionContextType {
  currentSfen: string | null;

  syncedSfen: string | null;

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
  const { state: presetsState, selectedPresetVersion } = useEnginePresets();
  const engineKey = presetsState.selectedPresetId
    ? `${presetsState.selectedPresetId}@${selectedPresetVersion}`
    : "no-engine";

  const [syncedEngineKey, setSyncedEngineKey] = React.useState<string | null>(
    null,
  );
  const lastEngineKeyRef = useRef<string | null>(engineKey);

  const [syncedSfen, setSyncedSfen] = React.useState<string | null>(null);
  const [isPositionSynced, setIsPositionSynced] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  // --- 多重呼び出し対策の中核 ---
  const inFlightRef = useRef<Promise<void> | null>(null);
  const queuedSfenRef = useRef<string | null>(null);

  // ready前の保留（NotInitialized 根絶）
  const pendingBeforeReadyRef = useRef<string | null>(null);

  const isNotInitializedError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      msg.includes("NotInitialized") || msg.includes("Engine not initialized")
    );
  };

  // ✅ GameContextから現在のSFENを取得
  // jkfPlayerが同一参照でも中身が変わるので「毎回計算」でOK
  const getCurrentSfen = useCallback((): string | null => {
    try {
      if (!gameState.jkfPlayer?.shogi) return null;

      const sfen = gameState.jkfPlayer.shogi.toSFENString(
        gameState.jkfPlayer.tesuu || 1,
      );
      return sfen;
    } catch (error) {
      console.error("❌ [POSITION] Error getting SFEN:", error);
      return null;
    }
  }, [gameState.jkfPlayer, gameState.cursor]);

  const syncPosition = useCallback(async (): Promise<void> => {
    setSyncError(null);

    const sfen = getCurrentSfen();
    if (!sfen) {
      setIsPositionSynced(false);
      setSyncedSfen(null);
      pendingBeforeReadyRef.current = null;
      queuedSfenRef.current = null;
      return;
    }

    // ready前は送らない（保留して終了）
    if (!isReady) {
      pendingBeforeReadyRef.current = sfen;
      setIsPositionSynced(false);
      return;
    }

    // すでに送れてるなら何もしない
    if (syncedSfen === sfen && syncedEngineKey === engineKey) {
      setIsPositionSynced(true);
      return;
    }

    // 送りたい最新をキューに積む（latest wins）
    queuedSfenRef.current = sfen;

    // すでに送信中なら、ここで終わり（多重送信を防ぐ）
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    // 送信ループ：キューがある限り直列に送る（最後の1つだけが最終反映）
    inFlightRef.current = (async () => {
      while (queuedSfenRef.current) {
        const target = queuedSfenRef.current;
        queuedSfenRef.current = null;

        try {
          await setPositionFromSfen(target);

          setSyncedSfen(target);
          setSyncedEngineKey(engineKey);
          setIsPositionSynced(true);
        } catch (e) {
          // 万一NotInitializedなら ready待ちへ戻す
          if (isNotInitializedError(e)) {
            pendingBeforeReadyRef.current = target;
            setIsPositionSynced(false);
            return;
          }

          const msg = e instanceof Error ? e.message : "Position sync failed";
          setSyncError(msg);
          setIsPositionSynced(false);
          // ここで止める（エラー時は連鎖しない）
          return;
        }
      }
    })().finally(() => {
      inFlightRef.current = null;
    });

    return inFlightRef.current;
  }, [getCurrentSfen, isReady, syncedSfen, syncedEngineKey, engineKey]);

  useEffect(() => {
    if (lastEngineKeyRef.current === engineKey) return;

    lastEngineKeyRef.current = engineKey;

    setSyncedSfen(null);
    setSyncedEngineKey(engineKey);
    setIsPositionSynced(false);
  }, [engineKey]);

  //  自動同期：cursor変化で追従
  useEffect(() => {
    if (!gameState.jkfPlayer) {
      setIsPositionSynced(false);
      setSyncedSfen(null);
      pendingBeforeReadyRef.current = null;
      queuedSfenRef.current = null;
      return;
    }
    syncPosition().catch(() => {});
  }, [gameState.cursor, gameState.jkfPlayer, syncPosition]);

  // ✅ readyになった瞬間、ready前に溜めたSFENがあればキューに入れて送る
  useEffect(() => {
    if (!isReady) return;
    const pending = pendingBeforeReadyRef.current;
    if (!pending) return;

    pendingBeforeReadyRef.current = null;
    // 最新としてキューに積む
    queuedSfenRef.current = pending;
    syncPosition().catch(() => {});
  }, [isReady, syncPosition]);

  const currentSfen = getCurrentSfen();

  const value = useMemo(
    () => ({
      currentSfen,
      syncedSfen,
      syncPosition,
      isPositionSynced,
      syncError,
    }),
    [currentSfen, syncedSfen, syncPosition, isPositionSynced, syncError],
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
