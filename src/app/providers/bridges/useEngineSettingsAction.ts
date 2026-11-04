import { useEffect, useMemo, useRef } from "react";
import type { NotifyAction } from "@/shared/lib/notification/types";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 通知に付ける「設定を開く」を返す。押すと設定のエンジン管理を開く。
 *
 * 返す値は描き直しても同じものなので、通知を出す effect の依存に入れても出し直さない。
 * `openModal` は URL が変わるたびに別物になるので、ref に持って押したときに最新を呼ぶ。
 * `openModal` を依存に入れると、画面を動かすたびに cleanup → `notify` が走り、
 * 利用者が閉じた通知が黙って戻る。
 */
export function useEngineSettingsAction(): NotifyAction {
  const { openModal } = useURLParams();
  const openSettings = useRef(openModal);

  useEffect(() => {
    openSettings.current = openModal;
  }, [openModal]);

  return useMemo(
    () => ({
      label: "設定を開く",
      run: () => openSettings.current("settings", { tab: "engine" }),
      // 帯はヘッダを覆っているので、閉じるまで歯車には届かない。
      // 歯車が開くのはワークスペースタブなので、行き先のタブまで書く
      failureBody:
        "この通知を閉じて、画面右上の歯車から設定を開き、「エンジン管理」を選択してください。",
    }),
    [],
  );
}
