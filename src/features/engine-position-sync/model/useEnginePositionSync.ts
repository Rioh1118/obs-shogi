import { useEngine } from "@/entities/engine";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { useGame } from "@/entities/game";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setPositionFromSfen } from "@/entities/engine/api/tauri";
import type { PositionSyncAdapter } from "@/entities/analysis";

/**
 * 盤の現在局面をエンジンに送り続ける。
 *
 * entities/game・entities/engine・entities/engine-presets の3スライスを束ねるので、
 * FSD 上これを置ける最下層は features になる。
 *
 * **アプリ全体で1箇所だけがマウントすること（`AnalysisBridge`）。** 送信の直列化は
 * このフックのインスタンスが持つキューで行っているが、送り先のエンジンはプロセス1本なので、
 * 2箇所でマウントすると互いのキューを知らないまま同じエンジンへ書き込む。
 *
 * 返す `syncPosition` は、エンジンへの送信に失敗すると reject する。ただし自動追従の
 * 経路（局面やエンジンの変化に反応して呼ぶ側）はこのフックの中で握り潰しているので、
 * 失敗を観測できるのは手動で呼んだ呼び出し元だけである。
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

  // 送信の周回ごとに読む。await の後で世代が変わっていれば、その周回の結果は
  // 別のエンジン・別の棋譜に対するものなので書き戻さない。
  const generationRef = useRef(0);

  // 送信ループが読む engineKey。クロージャに焼き付けると切替後も古い値を書く。
  const engineKeyRef = useRef(engineKey);
  engineKeyRef.current = engineKey;

  const markSynced = useCallback((sfen: string, key: string | null) => {
    syncedSfenRef.current = sfen;
    syncedEngineKeyRef.current = key;
    setSyncedSfen(sfen);
  }, []);

  /**
   * 送信済みの記録を捨て、進行中の送信の書き戻しを無効にする。
   * 世代を上げる操作をここに閉じてあるのは、リセットの契機が複数あり
   * どれか1つで上げ忘れると「送っていないのに送れたことになる」ためである。
   */
  const invalidateSynced = useCallback((nextEngineKey: string | null) => {
    generationRef.current += 1;
    syncedSfenRef.current = null;
    syncedEngineKeyRef.current = nextEngineKey;
    setSyncedSfen(null);
  }, []);

  const lastEngineKeyRef = useRef<string | null>(engineKey);
  const lastReadyRef = useRef(isReady);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const queuedSfenRef = useRef<string | null>(null);

  const pendingBeforeReadyRef = useRef<string | null>(null);

  const currentSfen = gameView.currentSfen;

  const syncPosition = useCallback(async (): Promise<void> => {
    const sfen = currentSfen;
    if (!sfen) {
      invalidateSynced(syncedEngineKeyRef.current);
      pendingBeforeReadyRef.current = null;
      queuedSfenRef.current = null;
      return;
    }

    if (!isReady) {
      pendingBeforeReadyRef.current = sfen;
      return;
    }

    if (syncedSfenRef.current === sfen && syncedEngineKeyRef.current === engineKeyRef.current) {
      return;
    }

    queuedSfenRef.current = sfen;

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    inFlightRef.current = (async () => {
      let failure: unknown = null;

      while (queuedSfenRef.current) {
        const target = queuedSfenRef.current;
        queuedSfenRef.current = null;

        // 世代は周回ごとに読む。ループ単位で捕まえると、送信中にエンジンが
        // 切り替わったとき、切替後に積み直された局面まで送らずに終わる。
        const generation = generationRef.current;

        try {
          await setPositionFromSfen(target);
          failure = null;
        } catch (e) {
          // キューを捨てない。失敗したのは target であって、その後に積まれた
          // 新しい局面まで巻き添えにすると、盤は進んでいるのにエンジンには
          // 誰も送らない状態が残る。
          //
          // NotInitialized も他の失敗と区別しない。ここへ来る時点で isReady は必ず true
          // （false なら送信前に保留して返している）ので、これはフロント側の準備完了判定が
          // 実態とずれている印であり、ready の再遷移を待っても来ない。
          failure = e;
          continue;
        }

        // await の間にエンジンや棋譜が変わっていたら、この結果は書き戻さない。
        // ここで return するとキューが残ったまま誰も引かなくなる。
        if (generation !== generationRef.current) continue;

        markSynced(target, engineKeyRef.current);
      }

      // 呼び出し元へ投げる。握り潰すと、エンジンに別の局面が入ったまま
      // 解析が始まり、盤面と一致しない候補手が黙って表示される。
      if (failure) throw failure;
    })().finally(() => {
      inFlightRef.current = null;
    });

    return inFlightRef.current;
  }, [currentSfen, isReady, invalidateSynced, markSynced]);

  useEffect(() => {
    if (lastEngineKeyRef.current === engineKey) return;

    lastEngineKeyRef.current = engineKey;
    queuedSfenRef.current = null;
    invalidateSynced(engineKey);
  }, [engineKey, invalidateSynced]);

  // エンジンは engineKey が変わらなくても再起動しうる（AI ルートの変更など）。
  // 起動し直されたプロセスには何も送られていないので、送信済みの記録を捨てる。
  //
  // この effect は、保留していた局面を送り直す effect（下）より先に置くこと。
  // 逆にすると、そちらの syncPosition() が古い記録に対する「すでに送れてる」の
  // 判定で早期 return し、再起動後のエンジンへ一度も送られない。
  useEffect(() => {
    if (lastReadyRef.current === isReady) return;

    lastReadyRef.current = isReady;
    if (!isReady) return;

    invalidateSynced(syncedEngineKeyRef.current);
  }, [isReady, invalidateSynced]);

  //  自動同期：cursor変化で追従
  useEffect(() => {
    if (!gameState.cursor) {
      invalidateSynced(syncedEngineKeyRef.current);
      pendingBeforeReadyRef.current = null;
      queuedSfenRef.current = null;
      return;
    }
    syncPosition().catch(() => {});
  }, [engineKey, gameState.cursor, syncPosition, invalidateSynced]);

  useEffect(() => {
    if (!isReady) return;
    if (!pendingBeforeReadyRef.current) return;

    // 保留していた SFEN そのものは積み直さない。syncPosition が現在の局面を読むので
    // 積み直しは同じ値の重複にしかならない（保留は盤が動くたびに更新される）。
    // ここでは「ready になったので送り直す」という合図だけを担う。
    pendingBeforeReadyRef.current = null;

    // 同じコミットで自動同期の effect が既に送信を始めていれば、それに任せる。
    // ここで重ねて呼ぶと同じ局面を2回送ることになる。
    if (inFlightRef.current) return;
    syncPosition().catch(() => {});
  }, [isReady, syncPosition]);

  return useMemo(
    () => ({ currentSfen, syncedSfen, syncPosition }),
    [currentSfen, syncedSfen, syncPosition],
  );
}
