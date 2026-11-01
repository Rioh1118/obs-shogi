import { useCallback } from "react";

import { useURLParams } from "@/shared/lib/router/useURLParams";
import type { TabKey } from "./tabs";

/**
 * 設定モーダルを開く関数を返す。タブは `TabKey` で受ける。
 *
 * `URLParams["tab"]` は素の `string` で、`SettingsPanel` は知らない名前を既定のタブへ
 * 落とす。設定は開くので、押した人が気づく手掛かりは開いた先が違うことだけになる。
 * `tab` の欄は `create-file` も別の語彙で読むので、`shared` 側の型では閉じられない。
 */
export function useOpenSettings(): (tab: TabKey) => void {
  const { openModal } = useURLParams();

  return useCallback((tab: TabKey) => openModal("settings", { tab }), [openModal]);
}
