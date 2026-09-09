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
 * **`engine` の `state.error` を読む UI はここだけ。** ここが黙ると、失敗しても
 * 画面は「解析を始められない」だけになり、理由も次の一手もどこにも出ない。
 * 帯にするのは、エンジンが要る画面（解析ペイン）と直せる画面（設定）が
 * 別なので、**どちらを開いていても届く必要がある**ため。
 *
 * **`state.error` を描かずに `notify` を呼ぶ**のは ADR-0004 決定6。
 * 帯を閉じてもエンジンが起動していないことは変わらない。
 *
 * **段は `danger`。** 同じ設定で起動し直しても結果は変わらない
 * （`provider.tsx` は同じ runtime では再トライしない）。`warning` にすると
 * 「もう一度で直る」と読める。
 */
export function EngineFailureBridge() {
  const { state } = useEngine();
  const { notify, dismissByKey } = useNotify();
  const { openModal } = useURLParams();

  // 押されるのは通知に積まれたあと。`openModal` は URL が変わるたびに
  // 別物になるので、依存に入れると**画面を動かすたびに帯が積み直され**、
  // 閉じたはずの帯が戻り、件数だけが増える
  const openSettings = useRef(openModal);
  useEffect(() => {
    openSettings.current = openModal;
  }, [openModal]);

  const { phase, error } = state;

  useEffect(() => {
    if (phase !== "error") return;

    // **原因はログへ。** 画面に出す文言は利用者の言葉に限るので、
    // Rust から来た文（`Engine initialization failed: …`）はここでしか残らない
    console.error("[engine] 初期化に失敗した", error);

    notify({
      tier: "danger",
      // **帯はヘッダを覆う**ので、閉じる以外にやることが無い帯は出せない
      //（`NotificationLayer.scss`）。ここでは「設定を開く」がそれに当たる
      presentation: "banner",
      dedupeKey: ENGINE_INIT_FAILURE,
      title: "エンジンを起動できませんでした",
      // **「同じ設定でもう一度」を勧めない。** 押しても何も起きない
      //（同じ runtime では再トライしない）。直る道は設定を直すことだけなので、
      // そこへ送ってから、直せば自動で起動し直すことまで書く
      body:
        "解析はできません。設定の「エンジン管理」で、選んでいるプリセットの" +
        "エンジンと評価関数の場所を確かめてください。設定を直すと自動でもう一度起動します。",
      actions: [
        {
          label: "設定を開く",
          run: () => openSettings.current("settings", { tab: "engine" }),
          // 帯はヘッダを覆っているので、閉じるまで歯車には届かない
          failureBody: "この通知を閉じて、画面右上の歯車から設定を開いてください。",
        },
      ],
    });

    // **起動し直せたら引っ込める。** 出しっぱなしにすると、動いているエンジンの上に
    // 「起動できませんでした」が残り、しかもヘッダを覆い続ける。
    // 二重に出さないのもここ——StrictMode の張り直しで件数が 2 から始まらない
    return () => dismissByKey(ENGINE_INIT_FAILURE);
  }, [phase, error, notify, dismissByKey]);

  return null;
}
