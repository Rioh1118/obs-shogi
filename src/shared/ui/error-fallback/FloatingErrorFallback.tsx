import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ErrorFallbackAction,
  ErrorFallbackBody,
  type ErrorFallbackBodyProps,
} from "./ErrorFallbackBody";
import "./FloatingErrorFallback.scss";

/**
 * 浮かせた枠を積む器。`index.html` が `#modal-root` の後ろに置いている。
 *
 * **1枚ずつが自分で座標を決めない。** 器が縦に積むので、同時に何枚出ても重ならない。
 * 器を先に用意しておくのは、落ちた後に DOM を作りに行かずに済ませるため。
 */
const OVERLAY_ROOT_ID = "error-overlay-root";

/**
 * 平常時に in-flow の箱を作らない部品を包む境界の `fallback`。
 *
 * `UpdaterScreen` は `createPortal` で出し、モーダルの層は閉じている間 `null` を返す。
 * この2つを流れの中の箱で置き換えると、親の grid の行や flex の列を1つ食って
 * 周りの部品が暗黙の行へ押し出される —— 1枚の事故で本体を畳まないための境界が、
 * 本体を畳むことになる。だから器へ逃がす。
 *
 * **閉じる手段を自分で持つ。** `RETRY_LABEL` の出口が効かない失敗では箱は自分から消えないので、
 * 無いとそのセッションのあいだ他の部品を覆い続ける。**閉じても子は戻らない** ——
 * 畳みを解くのは `AppErrorBoundary` の `reset` だけで、ここが返す `null` は
 * 「この箱を描かない」しか意味しない。原因を踏み直さないのはそのため。
 */
export function FloatingErrorFallback({ extraActions, ...body }: ErrorFallbackBodyProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  // 器が無ければ `body` へ落とす。**積む順は失うが、出ないよりはよい** ——
  // この箱が出る場面では、それが利用者に残る唯一の説明になる
  const root = document.getElementById(OVERLAY_ROOT_ID) ?? document.body;

  return createPortal(
    <div className="error-overlay__item">
      <ErrorFallbackBody
        {...body}
        extraActions={
          <>
            {extraActions}
            <ErrorFallbackAction secondary onClick={() => setDismissed(true)}>
              閉じる
            </ErrorFallbackAction>
          </>
        }
      />
    </div>,
    root,
  );
}
