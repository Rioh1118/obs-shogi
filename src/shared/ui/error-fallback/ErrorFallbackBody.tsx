import type { ReactNode } from "react";
import "./ErrorFallbackBody.scss";

/**
 * 畳むのをやめる出口の文言。
 *
 * 案内（`hint`）がこの語を本文に埋めるので、手書きにするとボタンの改名で**存在しないボタンを名指しする**。
 * `src/__tests__/errorBoundaryInventory.test.ts` が写しを禁じている。
 */
export const RETRY_LABEL = "再表示";

export type ErrorFallbackBodyProps = {
  /** 畳まれた範囲の名前。`AppErrorBoundary` の `label` がそのまま来る */
  label: string;
  /**
   * 落ちた原因。**画面に出す唯一の場所。**
   *
   * `console.error` は配布版では誰も読めない（`devtools` の feature を入れておらず、
   * フロントの `console` をログファイルへ流す経路も無い）。ここで捨てると、
   * 利用者が報告できるのは「表示できませんでした」の一文だけになる。
   */
  error: unknown;
  /** 畳むのをやめて描き直す。原因が境界の外にあるなら効かない */
  reset: () => void;
  /**
   * 次に何をすればよいか。**畳まれた範囲ごとに違う**ので、置く側が決める。
   *
   * `再表示` は境界の `error` を消すだけで、原因が境界の外にあれば同じ行で落ち直す。
   * ここが無いと、押しても変わらないボタン1つだけが残る行き止まりになる。
   */
  hint?: ReactNode;
  /**
   * 「再表示」の隣に並べる出口。再表示で戻らなかったときに使う `ErrorFallbackAction` を渡す。
   *
   * `children` にしないのは、`AppErrorBoundary` の `children`（囲う対象）と逆の意味になるため。
   * `actions` にしないのは、`notification/Notice` の `actions` が描画済みの要素でなく `NotifyAction[]` を指すため。
   */
  extraActions?: ReactNode;
  /**
   * 出口を押した結果の知らせ。重ねると出口を覆うので、出口の下に流れで置く。
   *
   * `notice` にしないのは、`notification/Notice` が失敗を伝える箱の名前として先に使っているため。
   */
  afterAction?: ReactNode;
};

/**
 * 落ちたことを伝える本文。3通りの置き方で共有する。
 *
 * 流れの中に出す境界はこれをそのまま `fallback` に渡し、浮かせて出す境界は `FloatingErrorFallback` が、
 * ウィンドウ枠ごと差し替える境界は `app/RootErrorFallback.tsx` が包む。
 * 包む側が決めるのは置き方と、その置き方に固有の出口だけ。本文の写しを持たせると文言が片方だけ変わる。
 */
export function ErrorFallbackBody({
  label,
  error,
  reset,
  hint,
  extraActions,
  afterAction,
}: ErrorFallbackBodyProps) {
  // `throw` される値は `Error` とは限らない。**`String()` で落とさない** ——
  // plain object を投げると `[object Object]` がそのまま画面に出て、
  // 案内（`hint`）より目立つ位置に意味の無い1行が入る
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return (
    <div className="error-fallback">
      <p>{label}を表示できませんでした。</p>
      {/*
        **これは報告用の材料で、利用者向けの説明ではない。** レンダ経路で実際に投げられるのは
        `plan walk overflows` のような開発者向けの英語なので、見出しを添えて役割を割る。
        次に何をすればよいかは `hint` が持つ
      */}
      {detail && <p className="error-fallback__detail">技術的な内容: {detail}</p>}
      {hint && <p className="error-fallback__hint">{hint}</p>}
      <div className="error-fallback__actions">
        <ErrorFallbackAction onClick={reset}>{RETRY_LABEL}</ErrorFallbackAction>
        {extraActions}
      </div>
      {afterAction}
    </div>
  );
}

/**
 * 落ちた画面に並べるボタン。class 名を `shared/ui` の中に閉じるために部品にする。
 *
 * 呼び手に class を書かせると、`shared` 側で整理したときに黙って素の `<button>` へ戻る。
 */
export function ErrorFallbackAction({
  onClick,
  /** 「再表示」で戻らなかったときの出口。同じ強さで並べると、先に試すべき方が読めなくなる */
  secondary = false,
  children,
}: {
  /**
   * 押されたときにすること。非同期でよい。
   *
   * `() => void` に絞ると `() => Promise<void>` が代入でき、拒否が拾われないまま消える。
   *
   * ここで握るのは未処理の拒否にしないためだけで、`console.error` は配布版では読めない。
   * **拒否を画面に出すのは呼び手の責任**で、置き場は `afterAction`（`app/RootErrorFallback.tsx` の `closeFailed`）。
   */
  onClick: () => void | Promise<void>;
  secondary?: boolean;
  children: ReactNode;
}) {
  const run = () => {
    const result = onClick();
    if (result) {
      void result.catch((cause: unknown) => {
        console.error("[ErrorFallbackAction] 出口が失敗:", cause);
      });
    }
  };

  return (
    <button
      type="button"
      className={`error-fallback__action${secondary ? " error-fallback__action--secondary" : ""}`}
      onClick={run}
    >
      {children}
    </button>
  );
}
