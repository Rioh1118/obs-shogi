import { useEffect, useRef } from "react";
import { engineFailureNoticeOf, useEngine } from "@/entities/engine";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { useEngineSettingsAction } from "./useEngineSettingsAction";

/**
 * 起動の失敗の帯を引っ込めるための取っ手。帯は `engineFailureNoticeOf` が文を返す間だけ出るので、
 * 条件を抜けたときに指せる名前が要る（`NotificationActions`）。
 *
 * **畳む鍵（`dedupeKey`）ではない。** この帯は条件から出ていて2枚目が積まれようが
 * ないので、畳む鍵にすると「1件」が出たまま動かない（`Notification.count`）。
 */
const ENGINE_FAILURE = "engine-failure";

/** 起動に時間が掛かっている帯の取っ手。起動中の段を抜けたら引っ込める */
const ENGINE_SLOW_START = "engine-slow-start";

/**
 * エンジンを起動できなかったこと、止まったこと、起動に時間が掛かっていることを帯で利用者へ届ける
 * （`failure-surfacing.md` の F-9。帯の段は種類ごと。`ENGINE_START_FAILURE_NOTICES`）。
 *
 * **エンジンの失敗の文を出すのはここだけ。** 操作列（`AnalysisControls`）は語とボタンだけを持ち、
 * 理由を言わない。ここが黙ると、理由も次の一手もどこにも出ない。
 * 帯にするのは、エンジンが要る画面（解析ペイン）と直せる画面（設定）が
 * 別なので、どちらを開いていても届く必要があるため。
 *
 * 段・本文・「もう一度起動」を出すかは `engineFailureNoticeOf` が `phase`、失敗の種類
 * （`state.error.kind`）、応答しない理由、プリセットの未設定から決める。
 * `state.error.message` はエンジンの出力を含み利用者の言葉ではないので、画面に出さずログへ回す。
 * 状態としてのエラーを描かずに通知へ回すのは ADR-0004 決定6。
 * 帯を閉じてもエンジンが起動していないことは変わらない。
 */
export function EngineFailureBridge() {
  const { state, initialize, cancelStart, presetIncomplete, slowStart } = useEngine();
  const { notify, dismissByKey } = useNotify();
  const openSettings = useEngineSettingsAction();
  const { phase, error, unresponsiveReason } = state;

  // `initialize` は `desiredRuntime` が変わるたびに別物になる。下の effect の依存に入れると、
  // 設定を触るたびに cleanup → `notify` が走り、閉じた帯が出し直される。押したときに最新を掴む
  const startAgain = useRef(initialize);
  useEffect(() => {
    startAgain.current = initialize;
  }, [initialize]);
  const stopStarting = useRef(cancelStart);
  useEffect(() => {
    stopStarting.current = cancelStart;
  }, [cancelStart]);

  const notice = engineFailureNoticeOf({ phase, error, unresponsiveReason, presetIncomplete });
  // 下の effect の依存は欄の値で持つ。`notice` は描くたびに作り直すオブジェクトなので、
  // そのまま依存に入れると描くたびに帯を出し直す
  const tier = notice?.tier;
  const title = notice?.title;
  const body = notice?.body;
  const retry = notice?.retry;
  const startFailure = notice?.startFailure;

  // 起動中が長引いたら、止めるボタンを出す。段を抜けたら（起動できた・失敗した・止めた）引っ込める
  useEffect(() => {
    if (!slowStart) return;
    notify({
      tier: "warning",
      presentation: "banner",
      dismissKey: ENGINE_SLOW_START,
      title: "エンジンの準備に時間が掛かっています",
      body:
        "評価関数の読み込みに時間が掛かるエンジンでは、このまま待てば使えるようになります。" +
        "中止するときは「起動を中止」を押してください。",
      actions: [{ label: "起動を中止", run: () => stopStarting.current() }, openSettings],
    });
    return () => dismissByKey(ENGINE_SLOW_START);
  }, [slowStart, openSettings, notify, dismissByKey]);

  // 文は `engineFailureNoticeOf` が操作列のポップオーバーと共有し、動作はここで組む。
  // 段を抜けたら引っ込める。動いているエンジンの上に古い帯を残さない（帯はヘッダを覆う）
  useEffect(() => {
    if (!tier || !title || !body) return;
    if (error) console.error("[engine] 起動に失敗した", error.kind, error.message);

    const startAgainAction = {
      label: startFailure ? "もう一度起動" : "再起動",
      run: async () => {
        await startAgain.current();
      },
    };

    notify({
      tier,
      title,
      body,
      // 帯はヘッダを覆うので、閉じる以外にやることが無い帯は出せない
      //（`NotificationLayer.scss`）。「設定を開く」は全部に付ける
      presentation: "banner",
      dismissKey: ENGINE_FAILURE,
      actions: retry ? [startAgainAction, openSettings] : [openSettings],
    });
    return () => dismissByKey(ENGINE_FAILURE);
  }, [tier, title, body, retry, startFailure, error, openSettings, notify, dismissByKey]);

  return null;
}
