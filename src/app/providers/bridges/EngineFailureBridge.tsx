import { useEffect, useRef } from "react";
import { useEngine } from "@/entities/engine";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { ENGINE_FAILURE_NOTICES } from "./engineFailureNotice";

/**
 * 引っ込めるための取っ手。**帯は条件（`phase === "error"`）と結び付いている**ので、
 * 抜けたときに指せる名前が要る（`NotificationActions`）。
 *
 * **畳む鍵（`dedupeKey`）ではない。** この帯は条件から出ていて2枚目が積まれようが
 * ないので、畳む鍵にすると「1件」が出たまま動かない（`Notification.count`）。
 */
const ENGINE_INIT_FAILURE = "engine-init-failure";

/**
 * エンジンを起動できなかったことを利用者へ届ける
 * （`failure-surfacing.md` の F-9 / ADR-0004 の割り当ては `danger` の帯）。
 *
 * **エンジンの失敗を描く UI はここだけ。** ここが黙ると、失敗しても画面は
 * 「解析を始められない」だけになり、理由も次の一手もどこにも出ない
 * （`useEngine` の他の読み手は `isReady` しか見ない）。
 * 帯にするのは、エンジンが要る画面（解析ペイン）と直せる画面（設定）が
 * 別なので、**どちらを開いていても届く必要がある**ため。
 *
 * **見ているのは `phase` と失敗の種類（`state.error.kind`）。** 文言は種類ごとの表
 * （`ENGINE_FAILURE_NOTICES`）から組む。`state.error.message` はエンジンの出力を含み
 * 利用者の言葉ではないので、画面に出さずログへ回す。
 * 状態としてのエラーを描かずに通知へ回すのは ADR-0004 決定6——
 * 帯を閉じてもエンジンが起動していないことは変わらない。
 *
 * **段は種類で決まる。** 同じ設定では直る見込みが無い種類は `danger`（`provider.tsx` も
 * 同じ runtime では再トライしない）。同じ設定のまま直る見込みがある種類だけ `warning` で、
 * 「もう一度起動」を並べる。
 */
export function EngineFailureBridge() {
  const { state, initialize } = useEngine();
  const { notify, dismissByKey } = useNotify();
  const { openModal } = useURLParams();

  // 押されるのは通知に積まれたあと。`openModal` は URL が変わるたびに別物になるので、
  // 下の effect の依存に入れると**画面を動かすたびに cleanup → `notify` が走り、
  // 利用者が閉じた帯が黙って戻る**
  const openSettings = useRef(openModal);
  useEffect(() => {
    openSettings.current = openModal;
  }, [openModal]);
  // `initialize` も同じ理由で掴み直す（設定が変わるたびに別物になる）
  const startAgain = useRef(initialize);
  useEffect(() => {
    startAgain.current = initialize;
  }, [initialize]);

  const { phase, error } = state;

  useEffect(() => {
    if (phase !== "error") return;
    const kind = error?.kind ?? "unknown";
    const notice = ENGINE_FAILURE_NOTICES[kind];

    // **画面には利用者の言葉、原因はログ**（`Notice` の `invoke` と同じ分け方）。
    // 配布ビルドの記録は Rust 側が持つ（`bridge.rs` が `tauri-plugin-log` へ書く）ので、
    // ここは開発中に webview のコンソールで追うためのもの
    console.error("[engine] 起動に失敗した", kind, error?.message);

    const openSettingsAction = {
      label: "設定を開く",
      run: () => openSettings.current("settings", { tab: "engine" }),
      // 帯はヘッダを覆っているので、閉じるまで歯車には届かない。
      // **タブまで書く**——歯車が開くのはワークスペースタブ
      failureBody:
        "この通知を閉じて、画面右上の歯車から設定を開き、「エンジン管理」を選んでください。",
    };

    notify({
      tier: notice.tier,
      // **帯はヘッダを覆う**ので、閉じる以外にやることが無い帯は出せない
      //（`NotificationLayer.scss`）。「設定を開く」は全種類に付ける
      presentation: "banner",
      dismissKey: ENGINE_INIT_FAILURE,
      title: "エンジンを起動できませんでした",
      body: notice.body,
      actions: notice.retry
        ? [
            {
              label: "もう一度起動",
              run: async () => {
                await startAgain.current();
              },
            },
            openSettingsAction,
          ]
        : [openSettingsAction],
    });

    // **失敗の段を抜けたら引っ込める。** 起動し直せた回だけでなく、設定が外れて
    // 止まった回（`idle`）でも走る。出しっぱなしにすると、動いているエンジンの上に
    // 「起動できませんでした」が残り、しかもヘッダを覆い続ける。
    //
    // **二重に積まない**のは `dedupeKey` の畳みが担う（`reducer.ts`）。
    // ここが担うのは、条件が消えた側で帯を残さないこと。
    //
    // TODO(#533): `idle` へ落ちた回（設定を外した／プリセットを消した）は、
    // エンジンが止まったまま画面から断りが消える。差し替える断りを決めるまで、
    // 引っ込め方は変えない
    return () => dismissByKey(ENGINE_INIT_FAILURE);
  }, [phase, error, notify, dismissByKey]);

  return null;
}
