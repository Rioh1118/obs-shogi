import { useCallback } from "react";

import { useURLParams } from "@/shared/lib/router/useURLParams";
import type { TabKey } from "./tabs";

/**
 * 設定モーダルを、タブを名指して開く。
 *
 * **綴りで渡さないための口。** `URLParams["tab"]` は素の `string` で、`SettingsPanel` は
 * 知らない名前を黙って捨てて既定のタブへ落とす——設定は開くので、押した人が気づく
 * 手掛かりは**開いた先が違う**ことだけ。解析の断りは復帰操作としてエンジン管理タブでの
 * 操作を案内するので、そこへ着かないと案内が空振りする。
 *
 * **`tab` の欄は設定専用ではない**（`create-file` が `"create" | "import"` として
 * 同じ欄を読む）ので、`shared` 側の型では閉じられない。開く口をこちらに置いて閉じる。
 */
export function useOpenSettings(): (tab: TabKey) => void {
  const { openModal } = useURLParams();

  return useCallback((tab: TabKey) => openModal("settings", { tab }), [openModal]);
}
