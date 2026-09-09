import { useEffect, useRef } from "react";
import { useEngine } from "@/entities/engine";
import { useNotify } from "@/shared/lib/notification/useNotifications";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 出し消しの鍵。**帯は条件（`phase === "error"`）と結び付いている**ので、
 * 起動し直せたときに引っ込める側から指せる名前が要る（`NotificationActions`）。
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
 * **見ているのは `phase`。** `state.error` は画面に出さない（本文は利用者の言葉に
 * 限るため）ので、`notify` の中身はこの段に入ったこと自体から組む。
 * 状態としてのエラーを描かずに通知へ回すのは ADR-0004 決定6——
 * 帯を閉じてもエンジンが起動していないことは変わらない。
 *
 * **段は `danger`。** 同じ設定では直る見込みが無い（原因はパスや評価関数の不備で、
 * `provider.tsx` も同じ runtime では再トライしない）。`warning` にすると
 * 「もう一度で直る」と読める。
 */
export function EngineFailureBridge() {
  const { state } = useEngine();
  const { notify, dismissByKey } = useNotify();
  const { openModal } = useURLParams();

  // 押されるのは通知に積まれたあと。`openModal` は URL が変わるたびに別物になるので、
  // 下の effect の依存に入れると**画面を動かすたびに cleanup → `notify` が走り、
  // 利用者が閉じた帯が黙って戻る**
  const openSettings = useRef(openModal);
  useEffect(() => {
    openSettings.current = openModal;
  }, [openModal]);

  const { phase, error } = state;

  useEffect(() => {
    if (phase !== "error") return;

    // **画面には利用者の言葉、原因はログ**（`Notice` の `invoke` と同じ分け方）。
    // 配布ビルドの記録は Rust 側が持つ（`bridge.rs` が `tauri-plugin-log` へ書く）ので、
    // ここは開発中に webview のコンソールで追うためのもの
    console.error("[engine] 初期化に失敗した", error);

    notify({
      tier: "danger",
      // **帯はヘッダを覆う**ので、閉じる以外にやることが無い帯は出せない
      //（`NotificationLayer.scss`）。ここでは「設定を開く」がそれに当たる
      presentation: "banner",
      dedupeKey: ENGINE_INIT_FAILURE,
      title: "エンジンを起動できませんでした",
      // **「同じ設定でもう一度」を勧めない**（ADR-0004 の F-9）。原因が設定にある回は
      // 直さない限り同じ結果になり、押させるだけになる。
      //
      // **自動で起動し直すのは、設定を直した回だけ。** 起動できない原因は設定の外にも
      // ある（実行権限、応答しないボリューム）ので、そこまで「直せば起動する」と
      // 書くと、設定を確かめ終えた利用者が行き止まりに座る。最後の一手を書いておく
      body:
        "解析はできません。設定の「エンジン管理」で、選んでいるプリセットの" +
        "エンジンと評価関数の場所を確かめてください。設定を直せば自動でもう一度起動します。" +
        "設定が正しいのに起動しないときは、アプリを再起動してください。",
      actions: [
        {
          label: "設定を開く",
          run: () => openSettings.current("settings", { tab: "engine" }),
          // 帯はヘッダを覆っているので、閉じるまで歯車には届かない。
          // **タブまで書く**——歯車が開くのはワークスペースタブ
          failureBody:
            "この通知を閉じて、画面右上の歯車から設定を開き、「エンジン管理」を選んでください。",
        },
      ],
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
