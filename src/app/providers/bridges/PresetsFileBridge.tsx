import { useEffect, useRef } from "react";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import {
  PRESETS_LOAD_FAILED,
  PRESETS_SAVE_NOTICES,
  presetsLoadNoticeView,
  type PresetsFileNoticeView,
} from "./presetsFileNotice";

/** 読み込みで起きたことの取っ手。読み直すと出し直す（同じ取っ手で置き換える） */
const PRESETS_LOAD_NOTICE = "presets-load-notice";
/** 読めなかった件があることの取っ手 */
const PRESETS_UNREADABLE = "presets-unreadable";
/** 保存を断られたことの取っ手。次に保存できたら引っ込める */
const PRESETS_SAVE_FAILURE = "presets-save-failure";
/** 読み込みそのものが失敗したことの取っ手 */
const PRESETS_LOAD_FAILURE = "presets-load-failure";

/**
 * プリセットのファイルで起きたこと（移した・読めなかった・書けない・保存を断られた）を利用者へ届ける。
 *
 * **エンジン管理のタブの中に出さない。** 移行は起動のたびの読み込みで起き、利用者は
 * 設定を開いていない。帯と通知はどの画面にも届く（ADR-0004）。
 *
 * 見せ方は種類ごとの表（`presetsLoadNoticeView` / `PRESETS_SAVE_NOTICES`）から組む。
 * **読み込むたびに出し直す**（`loadSeq`）——閉じた通知も、読み直して同じ状態なら戻る。
 * Rust が返す理由の文字列（`reason` / `message`）は利用者の言葉ではないのでログへ回す。
 */
export function PresetsFileBridge() {
  const { state, reload } = useEnginePresets();
  const { notify, dismissByKey } = useNotify();
  const { openModal } = useURLParams();

  // どちらも render のたびに別物になりうる。effect の依存に入れると、画面を動かすたびに
  // cleanup → `notify` が走って閉じた通知が戻るので、押したときに最新を掴む
  const openSettings = useRef(openModal);
  useEffect(() => {
    openSettings.current = openModal;
  }, [openModal]);
  const readAgain = useRef(reload);
  useEffect(() => {
    readAgain.current = reload;
  }, [reload]);

  const { loadNotice, loadSeq, unreadableCount, saveFailure, status } = state;

  useEffect(() => {
    if (!loadNotice) return;
    console.warn("[presets] 読み込みで起きたこと", loadNotice);
    notify(request(presetsLoadNoticeView(loadNotice), PRESETS_LOAD_NOTICE));
    return () => dismissByKey(PRESETS_LOAD_NOTICE);
    // `loadSeq` は読み込むたびに上がる。同じ値の通知でも出し直すために依存に入れる
  }, [loadNotice, loadSeq, notify, dismissByKey]);

  useEffect(() => {
    if (status !== "error") return;
    notify(request(PRESETS_LOAD_FAILED, PRESETS_LOAD_FAILURE));
    return () => dismissByKey(PRESETS_LOAD_FAILURE);
  }, [status, notify, dismissByKey]);

  useEffect(() => {
    if (unreadableCount === 0) return;
    notify({
      tier: "warning",
      presentation: "toast",
      dismissKey: PRESETS_UNREADABLE,
      title: `読めなかったプリセットが ${unreadableCount} 件あります`,
      body: "ファイルには残してあります。",
    });
    return () => dismissByKey(PRESETS_UNREADABLE);
  }, [unreadableCount, loadSeq, notify, dismissByKey]);

  useEffect(() => {
    if (!saveFailure) return;
    notify(request(PRESETS_SAVE_NOTICES[saveFailure.kind], PRESETS_SAVE_FAILURE));
    return () => dismissByKey(PRESETS_SAVE_FAILURE);
  }, [saveFailure, notify, dismissByKey]);

  return null;

  function request(view: PresetsFileNoticeView, dismissKey: string): NotifyRequest {
    if (view.presentation === "toast") {
      return {
        tier: view.tier,
        presentation: "toast",
        autoDismiss: true,
        title: view.title,
        body: view.body,
      };
    }
    return {
      tier: view.tier,
      presentation: "banner",
      dismissKey,
      title: view.title,
      body: view.body,
      actions: [
        view.action === "reload"
          ? { label: "読み直す", run: () => readAgain.current() }
          : {
              label: "設定を開く",
              run: () => openSettings.current("settings", { tab: "engine" }),
              failureBody:
                "この通知を閉じて、画面右上の歯車から設定を開き、「エンジン管理」を選んでください。",
            },
      ],
    };
  }
}
