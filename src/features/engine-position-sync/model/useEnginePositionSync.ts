import { useEngine } from "@/entities/engine";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { useGame } from "@/entities/game";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setPositionFromSfen } from "@/entities/engine/api/tauri";
import type { PositionSyncAdapter } from "@/entities/analysis";

const isNotInitializedError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("NotInitialized") || msg.includes("Engine not initialized");
};

/**
 * 盤の現在局面をエンジンに送り続ける。
 *
 * entities/game・entities/engine・entities/engine-presets の3スライスを束ねるので、
 * FSD 上これを置ける最下層は features になる。
 */
export function useEnginePositionSync(): PositionSyncAdapter {
  const { state: gameState, view: gameView } = useGame();
  const { isReady } = useEngine();
  const { state: presetsState, selectedPresetVersion } = useEnginePresets();
  const engineKey = presetsState.selectedPresetId
    ? `${presetsState.selectedPresetId}@${selectedPresetVersion}`
    : "no-engine";

  const [syncedSfen, setSyncedSfen] = useState<string | null>(null);

  // syncPosition が読むと同時に書く値。state のまま依存に入れると、送信が成功する
  // たびに syncPosition の identity が変わり、それを依存に持つ自動同期 effect が
  // 同じ局面で二周する。読む側は ref、外へ見せる側は state に分ける。
  const syncedSfenRef = useRef<string | null>(null);
  const syncedEngineKeyRef = useRef<string | null>(null);

  const applySynced = useCallback((sfen: string | null, key: string | null) => {
    syncedSfenRef.current = sfen;
    syncedEngineKeyRef.current = key;
    setSyncedSfen(sfen);
  }, []);

  const lastEngineKeyRef = useRef<string | null>(engineKey);

  // 送信中に engineKey が変わったら、その前に始まった送信の書き戻しを無効にする。
  // await の後で「その間に条件が変わったか」を検査しないと、古いクロージャが
  // 切替後のリセットを打ち消す。
  const generationRef = useRef(0);

  // 送信ループが読む engineKey。クロージャに焼き付けると切替後も古い値を書く。
  const engineKeyRef = useRef(engineKey);
  engineKeyRef.current = engineKey;

  // --- 多重呼び出し対策の中核 ---
  const inFlightRef = useRef<Promise<void> | null>(null);
  const queuedSfenRef = useRef<string | null>(null);

  // ready前の保留（NotInitialized 根絶）
  const pendingBeforeReadyRef = useRef<string | null>(null);

  const currentSfen = gameView.currentSfen;

  const syncPosition = useCallback(async (): Promise<void> => {
    const sfen = currentSfen;
    if (!sfen) {
      applySynced(null, syncedEngineKeyRef.current);
      pendingBeforeReadyRef.current = null;
      queuedSfenRef.current = null;
      return;
    }

    // ready前は送らない（保留して終了）
    if (!isReady) {
      pendingBeforeReadyRef.current = sfen;
      return;
    }

    // すでに送れてるなら何もしない
    if (syncedSfenRef.current === sfen && syncedEngineKeyRef.current === engineKeyRef.current) {
      return;
    }

    // 送りたい最新をキューに積む（latest wins）
    queuedSfenRef.current = sfen;

    // すでに送信中なら、ここで終わり（多重送信を防ぐ）
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    // 送信ループ：キューがある限り直列に送る（最後の1つだけが最終反映）
    const generation = generationRef.current;
    inFlightRef.current = (async () => {
      while (queuedSfenRef.current) {
        const target = queuedSfenRef.current;
        queuedSfenRef.current = null;

        try {
          await setPositionFromSfen(target);

          // await の間にエンジンが切り替わっていたら、この結果は捨てる。
          if (generation !== generationRef.current) return;

          applySynced(target, engineKeyRef.current);
        } catch (e) {
          // 万一NotInitializedなら ready待ちへ戻す
          if (isNotInitializedError(e)) {
            pendingBeforeReadyRef.current = target;
            return;
          }

          // 呼び出し元へ投げる。ここで握り潰すと、エンジンに1手前の局面が
          // 入ったまま解析が始まり、盤面と一致しない候補手が黙って表示される。
          queuedSfenRef.current = null;
          throw e;
        }
      }
    })().finally(() => {
      inFlightRef.current = null;
    });

    return inFlightRef.current;
  }, [currentSfen, isReady, applySynced]);

  useEffect(() => {
    if (lastEngineKeyRef.current === engineKey) return;

    lastEngineKeyRef.current = engineKey;

    // 進行中の送信の書き戻しを無効にしてからリセットする。
    generationRef.current += 1;
    queuedSfenRef.current = null;
    applySynced(null, engineKey);
  }, [engineKey, applySynced]);

  //  自動同期：cursor変化で追従
  useEffect(() => {
    if (!gameState.cursor) {
      applySynced(null, syncedEngineKeyRef.current);
      pendingBeforeReadyRef.current = null;
      queuedSfenRef.current = null;
      return;
    }
    syncPosition().catch(() => {});
  }, [engineKey, gameState.cursor, syncPosition, applySynced]);

  useEffect(() => {
    if (!isReady) return;
    const pending = pendingBeforeReadyRef.current;
    if (!pending) return;

    pendingBeforeReadyRef.current = null;
    // 最新としてキューに積む
    queuedSfenRef.current = pending;
    syncPosition().catch(() => {});
  }, [isReady, syncPosition]);

  return useMemo(
    () => ({ currentSfen, syncedSfen, syncPosition }),
    [currentSfen, syncedSfen, syncPosition],
  );
}
