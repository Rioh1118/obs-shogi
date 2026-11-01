import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { loadUpdaterState, saveUpdaterState } from "../api/updaterState";
import { UpdaterContext } from "./context";
import type { ManualCheckResult, UpdaterState, UpdaterStatus } from "./types";

/**
 * 確認を諦めるまでの時間。渡さないと待ち続ける。
 *
 * plugin は上限を省くと reqwest の既定（無期限）になるので、応答を返さない経路
 * （captive portal など）に当たると確認が永久に終わらない。起動時の確認は1回だけなので、
 * 固まると設定から押すまで更新に気づけない。
 */
const CHECK_TIMEOUT_MS = 30_000;

/** 確認を始めたのは誰か。結果を返す相手が居るのは `manual` だけ */
type CheckOrigin = "boot" | "manual";

function closeQuietly(update: Update) {
  // 破棄の失敗は利用者に関係しない。Rust 側の資源が1つ残るだけ
  void update.close().catch(() => {});
}

function leaveChecking(status: UpdaterStatus): UpdaterStatus {
  return status.phase === "checking" ? { phase: "idle" } : status;
}

/**
 * 更新の状態機械。
 *
 * `RequireRootDir` の内側に置かない。設定が読めない状態を直す版が、その状態のせいで
 * 届かなくなる。段の意味と遷移は `docs/state-transitions/updater.md` が持つ。
 */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdaterStatus>({ phase: "idle" });
  const [persisted, setPersisted] = useState<UpdaterState | null>(null);
  const [manualCheck, setManualCheck] = useState<ManualCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  /** いま告知している版の実体。取得の呼び出しが描画をまたいで同じ相手を握る */
  const updateRef = useRef<Update | null>(null);

  /**
   * 取得が走っているか、入替まで終えたか。`status` で判定しない。
   *
   * 押した時点の `status` は最初のチャンクが届くまで `available` のまま動かない。
   * そこを判定にすると、同じ描画のクロージャを2回踏んだだけで取得と入替が2本走る。
   *
   * 入替の後も降ろさない。走っているプロセスは古いままなので、確認すると同じ版が
   * 見つかり、「再起動して適用」が告知へ戻る。降ろすのは失敗したときだけ。
   */
  const installStartedRef = useRef(false);

  /** 確認が走っているか。`isChecking` は描画用で、判定はこちらが持つ */
  const checkingRef = useRef(false);

  /** 起動時の読み込みと確認を一度だけにする。Strict Mode は effect を2回走らせる */
  const bootStartedRef = useRef(false);

  /**
   * 記憶の現在地。書くときは `persisted` でなくこちらを読む。
   *
   * 確認は最長で `CHECK_TIMEOUT_MS` 走り、その間に設定で「解除」を押せる。
   * 確認の始めに読んだ値を書き戻すと、押した解除が取り消される。
   */
  const persistedRef = useRef<UpdaterState | null>(null);

  const closeUpdate = useCallback(() => {
    const previous = updateRef.current;
    updateRef.current = null;
    if (previous) closeQuietly(previous);
  }, []);

  /**
   * 記憶を書き換える。`patch` に無い欄は現在地のまま残す。
   *
   * 欄を全部渡す形にしない。渡す側が読んだ時点の値を持ち回り、持ち回っている間に
   * 別の経路が書いた分を潰す。
   */
  const persist = useCallback(async (patch: Partial<UpdaterState>) => {
    const next: UpdaterState = {
      skippedVersion: null,
      lastCheckedMs: null,
      ...persistedRef.current,
      ...patch,
    };
    persistedRef.current = next;
    setPersisted(next);
    try {
      await saveUpdaterState(next);
    } catch (e) {
      // 書けなくても倒れる先は「告知が出る」側。画面には出さない
      console.error("[updater] updater.json を書けなかった", e);
    }
  }, []);

  /**
   * 確認する。
   *
   * 失敗を画面に出さない。断線は日常で、起動のたびに失敗を出すと利用者は読まずに
   * 閉じる癖がつく。残すのはコンソールの記録と、`lastCheckedMs` が動かないことの2つ。
   * 手で押したときだけ、押した本人に結果を返す。
   */
  const runCheck = useCallback(
    async (origin: CheckOrigin) => {
      if (checkingRef.current || installStartedRef.current) return;
      checkingRef.current = true;
      setIsChecking(true);
      if (origin === "manual") setManualCheck(null);
      setStatus((s) => (s.phase === "idle" ? { phase: "checking" } : s));

      const answer = (result: ManualCheckResult) => {
        if (origin === "manual") setManualCheck(result);
      };

      try {
        const update = await check({ timeout: CHECK_TIMEOUT_MS });

        await persist({ lastCheckedMs: Date.now() });

        // 待っている間に解除されていることがあるので、確認を始める前には読まない
        const skipped = persistedRef.current?.skippedVersion ?? null;

        if (!update) {
          setStatus(leaveChecking);
          answer({ kind: "upToDate" });
          return;
        }

        // 待っている間に取得が始まっていることがある。掴み替えると取得の相手を閉じる
        if (installStartedRef.current) {
          closeQuietly(update);
          answer({ kind: "found", version: update.version });
          return;
        }

        if (update.version === skipped) {
          closeQuietly(update);
          setStatus(leaveChecking);
          answer({ kind: "foundButSkipped", version: update.version });
          return;
        }

        closeUpdate();
        updateRef.current = update;
        setStatus({ phase: "available", version: update.version });
        answer({ kind: "found", version: update.version });
      } catch (e) {
        console.error("[updater] 更新の確認に失敗した", e);
        setStatus(leaveChecking);
        answer({ kind: "failed" });
      } finally {
        checkingRef.current = false;
        setIsChecking(false);
      }
    },
    [closeUpdate, persist],
  );

  const downloadAndInstall = useCallback(async () => {
    if (installStartedRef.current) return;
    const update = updateRef.current;
    if (!update) return;
    installStartedRef.current = true;

    // `await` より前に段を進める。最初のチャンクを待つと、その間ボタンが描かれたまま残り、
    // 押しても何も起きない
    setStatus({ phase: "downloading", progress: 0 });

    let downloaded = 0;
    let total = 0;
    // 取得が終わったかどうかが、失敗したときの段を決める。
    // 終わっていれば、落ちたのは署名の検証か入替のどちらか
    let downloadFinished = false;

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setStatus({
              phase: "downloading",
              progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
            break;
          case "Finished":
            // ここで `ready` にしない。合図は署名の検証より前に届く
            downloadFinished = true;
            setStatus({ phase: "installing" });
            break;
        }
      });
      setStatus({ phase: "ready" });
    } catch (e) {
      installStartedRef.current = false;
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[updater] 更新の適用に失敗した", e);
      setStatus({
        phase: "error",
        failure: { stage: downloadFinished ? "install" : "download", detail },
      });
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
    await persist({ skippedVersion: status.version });
  }, [closeUpdate, persist, status]);

  const unskip = useCallback(async () => {
    await persist({ skippedVersion: null });
    setManualCheck(null);
  }, [persist]);

  const checkNow = useCallback(async () => {
    await runCheck("manual");
  }, [runCheck]);

  // 記憶を読んでから確認する。順序を入れ替えると、飛ばす版が分かる前に確認が終わり、
  // 飛ばしたはずの版で告知が出る
  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;

    void (async () => {
      let state: UpdaterState = { skippedVersion: null, lastCheckedMs: null };
      try {
        state = await loadUpdaterState();
      } catch (e) {
        console.error("[updater] updater.json を読めなかった", e);
      }
      persistedRef.current = state;
      setPersisted(state);
      await runCheck("boot");
    })();
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
