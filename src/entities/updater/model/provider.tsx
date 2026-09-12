import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { loadUpdaterState, saveUpdaterState } from "../api/updaterState";
import { UpdaterContext } from "./context";
import type { ManualCheckResult, UpdaterState, UpdaterStatus } from "./types";

/**
 * 確認を諦めるまでの時間。
 *
 * **渡さないと待ち続ける。** plugin は上限を省くと reqwest の既定（無期限）に
 * なるので、応答を返さない経路（captive portal など）に当たると確認が
 * 永久に終わらない。確認は1起動に1回しか走らないため、そのまま固まると
 * **その起動では二度と更新に気づけない。**
 */
const CHECK_TIMEOUT_MS = 30_000;

/** 取得と適用の進み具合を、状態から独立に覚えておく欄 */
type Progress = { downloaded: number; total: number };

/**
 * 更新の状態機械。
 *
 * **`RequireRootDir` の内側に置かない。** 設定が読めない状態を直す版が、
 * その状態のせいで届かなくなる（`app/App.tsx` の置き場の理由と同じ）。
 *
 * **段の意味と遷移は `docs/state-transitions/updater.md` が持つ。ここに写さない。**
 */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdaterStatus>({ phase: "idle" });
  const [persisted, setPersisted] = useState<UpdaterState | null>(null);
  const [manualCheck, setManualCheck] = useState<ManualCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  /**
   * いま告知している版の実体。**状態に入れない。**
   *
   * 取得を始める関門（`inFlightRef`）を状態で作れないのと同じ理由で、
   * ここも描画をまたいで1つに定まっていなければならない。
   */
  const updateRef = useRef<Update | null>(null);

  /**
   * 取得が走っているか。**`status` で判定しない。**
   *
   * 押した時点の `status` は最初のチャンクが届くまで `available` のまま動かない。
   * そこを関門にすると、同じ描画のクロージャを2回踏んだだけで取得と入替が
   * 2本走る（配布先への往復1回ぶんの窓が常に開いている）。
   */
  const inFlightRef = useRef(false);

  /** 確認が走っているか。`isChecking` は描画用で、関門はこちらが持つ */
  const checkingRef = useRef(false);

  /** 起動時の確認を一度だけにする */
  const bootCheckedRef = useRef(false);

  const closeUpdate = useCallback(() => {
    const previous = updateRef.current;
    updateRef.current = null;
    if (!previous) return;
    // 破棄の失敗は利用者に関係しない。Rust 側の資源が1つ残るだけ
    void previous.close().catch(() => {});
  }, []);

  const persist = useCallback(async (next: UpdaterState) => {
    setPersisted(next);
    try {
      await saveUpdaterState(next);
    } catch (e) {
      // 書けなくても倒れる先は「告知が出る」側。画面には出さない
      console.error("[updater] updater.json を書けなかった", e);
    }
  }, []);

  /**
   * 確認する。`manual` は手で押したときだけ真。
   *
   * **失敗しても画面に出さない。** 断線は日常で、起動のたびに失敗を出すと
   * 利用者は読まずに閉じる癖がつく。代わりに残すのは2つ——コンソールの記録と、
   * `lastCheckedMs` が古いまま動かないこと。手で押したときだけ、押した本人に
   * 結果を返す。
   */
  const runCheck = useCallback(
    async (manual: boolean) => {
      if (checkingRef.current || inFlightRef.current) return;
      checkingRef.current = true;
      setIsChecking(true);
      if (manual) setManualCheck(null);
      setStatus((s) => (s.phase === "idle" ? { phase: "checking" } : s));

      // 飛ばす版は書かれた直後に読み直さない。`persisted` は `persist` が
      // 同じ描画で入れ替えているので、ここで見える値が最新
      const skipped = persisted?.skippedVersion ?? null;

      try {
        const update = await check({ timeout: CHECK_TIMEOUT_MS });

        await persist({
          skippedVersion: skipped,
          lastCheckedMs: Date.now(),
        });

        if (!update) {
          setStatus((s) => (s.phase === "checking" ? { phase: "idle" } : s));
          if (manual) setManualCheck({ kind: "upToDate" });
          return;
        }

        if (update.version === skipped) {
          void update.close().catch(() => {});
          setStatus((s) => (s.phase === "checking" ? { phase: "idle" } : s));
          if (manual)
            setManualCheck({
              kind: "foundButSkipped",
              version: update.version,
            });
          return;
        }

        closeUpdate();
        updateRef.current = update;
        setStatus({ phase: "available", version: update.version });
        if (manual) setManualCheck({ kind: "found", version: update.version });
      } catch (e) {
        console.error("[updater] 更新の確認に失敗した", e);
        setStatus((s) => (s.phase === "checking" ? { phase: "idle" } : s));
        if (manual) setManualCheck({ kind: "failed" });
      } finally {
        checkingRef.current = false;
        setIsChecking(false);
      }
    },
    [closeUpdate, persist, persisted],
  );

  // 記憶を読んでから確認する。**順序を入れ替えない**——飛ばす版が分かる前に
  // 確認を終えると、飛ばしたはずの版で告知が出る
  useEffect(() => {
    if (bootCheckedRef.current) return;
    bootCheckedRef.current = true;

    void (async () => {
      let state: UpdaterState = { skippedVersion: null, lastCheckedMs: null };
      try {
        state = await loadUpdaterState();
      } catch (e) {
        console.error("[updater] updater.json を読めなかった", e);
      }
      setPersisted(state);
    })();
  }, []);

  // `persisted` が入った直後に1回だけ確認する。`runCheck` は `persisted` を
  // 読むので、依存に入れずに呼ぶと飛ばす版を `null` のまま見る
  const bootRanRef = useRef(false);
  useEffect(() => {
    if (persisted === null || bootRanRef.current) return;
    bootRanRef.current = true;
    void runCheck(false);
  }, [persisted, runCheck]);

  const downloadAndInstall = useCallback(async () => {
    if (inFlightRef.current) return;
    const update = updateRef.current;
    if (!update) return;
    inFlightRef.current = true;

    // **`await` より前に段を進める。** 最初のチャンクを待ってから進めると、
    // その間ボタンが描かれたまま残る。関門は `inFlightRef` が持っているので
    // 2本目は走らないが、押しても何も起きないボタンを見せることになる
    setStatus({ phase: "downloading", progress: 0 });

    const progress: Progress = { downloaded: 0, total: 0 };
    // 取得が終わったかどうかが、失敗したときの段を決める。
    // 終わっていれば、落ちたのは署名の検証か入替のどちらか
    let downloadFinished = false;

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            progress.total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            progress.downloaded += event.data.chunkLength;
            setStatus({
              phase: "downloading",
              progress:
                progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0,
            });
            break;
          case "Finished":
            // **ここで `ready` にしない。** 合図は署名の検証より前に届く
            downloadFinished = true;
            setStatus({ phase: "installing" });
            break;
        }
      });
      setStatus({ phase: "ready" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[updater] 更新の適用に失敗した", e);
      setStatus({
        phase: "error",
        failure: { stage: downloadFinished ? "install" : "download", detail },
      });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const restart = useCallback(async () => {
    await relaunch();
  }, []);

  const dismiss = useCallback(() => {
    setStatus({ phase: "idle" });
  }, []);

  const skipCurrentVersion = useCallback(async () => {
    if (status.phase !== "available") return;
    closeUpdate();
    setStatus({ phase: "idle" });
    await persist({
      skippedVersion: status.version,
      lastCheckedMs: persisted?.lastCheckedMs ?? null,
    });
  }, [closeUpdate, persist, persisted, status]);

  const unskip = useCallback(async () => {
    await persist({
      skippedVersion: null,
      lastCheckedMs: persisted?.lastCheckedMs ?? null,
    });
    setManualCheck(null);
  }, [persist, persisted]);

  const checkNow = useCallback(async () => {
    await runCheck(true);
  }, [runCheck]);

  const value = useMemo(
    () => ({
      status,
      persisted,
      manualCheck,
      isChecking,
      downloadAndInstall,
      restart,
      dismiss,
      skipCurrentVersion,
      unskip,
      checkNow,
    }),
    [
      status,
      persisted,
      manualCheck,
      isChecking,
      downloadAndInstall,
      restart,
      dismiss,
      skipCurrentVersion,
      unskip,
      checkNow,
    ],
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}
