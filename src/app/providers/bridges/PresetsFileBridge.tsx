import { useEffect, useMemo, useRef } from "react";
import { useEnginePresets } from "@/entities/engine-presets";
import type { NotifyAction, NotifyRequest } from "@/shared/lib/notification/types";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import {
  PRESETS_LOAD_FAILED,
  PRESETS_SAVE_NOTICES,
  presetsLoadNoticeView,
  type PresetsFileNoticeView,
  type PresetsNoticeAction,
} from "./presetsFileNotice";
import { useEngineSettingsAction } from "./useEngineSettingsAction";

/** 読み込みで起きたことの取っ手。読み直すと出し直す（同じ取っ手で置き換える） */
const PRESETS_LOAD_NOTICE = "presets-load-notice";
/** 読めなかった件があることの取っ手 */
const PRESETS_UNREADABLE = "presets-unreadable";
/** 保存を断られたことの取っ手。次に保存できたら引っ込める */
const PRESETS_SAVE_FAILURE = "presets-save-failure";
/** 読み込みそのものが失敗したことの取っ手 */
const PRESETS_LOAD_FAILURE = "presets-load-failure";

/** 帯の動作の綴りごとに、押したときの動作 */
type NoticeActions = Record<PresetsNoticeAction, NotifyAction>;

/** 表の1枚を通知に組む。トーストは自分で消え、帯は表が選んだ動作を1つ持つ */
function noticeRequest(
  view: PresetsFileNoticeView,
  dismissKey: string,
  actions: NoticeActions,
): NotifyRequest {
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
    actions: [actions[view.action]],
  };
}

/**
 * プリセットのファイルで起きたこと（移した・読めなかった・書けない・保存を断られた）を利用者へ届ける。
 *
 * **エンジン管理のタブの中に出さない。** 移行は起動のたびの読み込みで起き、利用者は
 * 設定を開いていない。帯と通知はどの画面にも届く（ADR-0004）。
 *
 * 見せ方は種類ごとの表（`presetsLoadNoticeView` / `PRESETS_SAVE_NOTICES`）から組む。
 * 読み込むたびに出し直す（`loadSeq`）。閉じた通知も、読み直して同じ状態なら戻る。
 * Rust が返す理由の文字列（`reason` / `message`）は利用者の言葉ではないのでログへ回す。
 */
export function PresetsFileBridge() {
  const { state, reload } = useEnginePresets();
  const { notify, dismissByKey } = useNotify();
  const openSettings = useEngineSettingsAction();

  // `reload` は `useCallback` の依存（`adopt`、`enqueue` など）が作り直されるたびに別物になる。
  // effect の依存に入れると、そのたびに
  // cleanup → `notify` が走って閉じた通知が戻るので、押したときに最新を掴む
  const readAgain = useRef(reload);
  useEffect(() => {
    readAgain.current = reload;
  }, [reload]);
  const actions = useMemo<NoticeActions>(
    () => ({
      reload: { label: "もう一度読み込む", run: () => readAgain.current() },
      settings: openSettings,
    }),
    [openSettings],
  );

  const { loadNotice, loadSeq, unreadableCount, saveFailure, status } = state;

  useEffect(() => {
    if (!loadNotice) return;
    console.warn("[presets] 読み込みで起きたこと", loadNotice);
    notify(noticeRequest(presetsLoadNoticeView(loadNotice), PRESETS_LOAD_NOTICE, actions));
    return () => dismissByKey(PRESETS_LOAD_NOTICE);
    // `loadSeq` は読み込むたびに上がる。同じ値の通知でも出し直すために依存に入れる
  }, [loadNotice, loadSeq, actions, notify, dismissByKey]);

  useEffect(() => {
    if (status !== "error") return;
    notify(noticeRequest(PRESETS_LOAD_FAILED, PRESETS_LOAD_FAILURE, actions));
    return () => dismissByKey(PRESETS_LOAD_FAILURE);
  }, [status, actions, notify, dismissByKey]);

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
    notify(noticeRequest(PRESETS_SAVE_NOTICES[saveFailure.kind], PRESETS_SAVE_FAILURE, actions));
    return () => dismissByKey(PRESETS_SAVE_FAILURE);
  }, [saveFailure, actions, notify, dismissByKey]);

  return null;
}
