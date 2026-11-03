import { memo, useEffect, useRef, type CSSProperties } from "react";
import "./PositionHitItem.scss";

type Props = {
  relPath: string;
  fileName: string;
  isSameFile: boolean;

  tesuu: number;
  forks: number;

  isActive: boolean;

  /** 1 起点。`listbox` の子が仮想化で歯抜けになるので、位置は要素側が持つ */
  posInSet: number;
  setSize: number;

  /** 仮想リストが行を置く位置。行そのものなので、包まずにここへ当てる */
  style: CSSProperties;

  onSelect: () => void;
  onAccept: () => void;
};

function PositionHitItemBase({
  relPath,
  fileName,
  isSameFile,
  tesuu,
  forks,
  isActive,
  posInSet,
  setSize,
  style,
  onSelect,
  onAccept,
}: Props) {
  const ref = useRef<HTMLButtonElement | null>(null);

  // 焦点を選択に追従させる。両者が割れると、銅のリングと銅の面が別の行を指し、
  // Enter で開くのは面のほう、つまり読み上げが読んだ行とは別の行になる。
  //
  // このモーダルで焦点を取れるのはヒットの行だけなので、奪う相手がいない。
  // 開いた直後は行が0件で `Modal` の引き戻しが器そのものを掴んでおり、
  // その器はキーのハンドラより上にあるので矢印も Enter も届かない。
  // 最初の1件が着いた時点でここが焦点を引き取ることで、その行き止まりも閉じる。
  useEffect(() => {
    const el = ref.current;
    if (!isActive || !el) return;

    const listbox = el.closest<HTMLElement>('[role="listbox"]');
    if (document.activeElement !== el) el.focus({ preventScroll: true });

    return () => {
      // 仮想リストは画面外の行を外すので、選択している行が焦点を持ったまま消える。
      // 放っておくと焦点が <body> へ落ち、`Modal` の引き戻しが最初に見つかった行を
      // 掴むので、選択していない行にリングが移る。器へ預けておけば、
      // 行が戻ってきたときに上の focus() が拾い直す
      if (document.activeElement !== el) return;
      listbox?.focus({ preventScroll: true });
    };
  }, [isActive]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={isActive}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      // 選択している行だけを Tab の止まり場にして、焦点と選択を割らない
      tabIndex={isActive ? 0 : -1}
      className={["pos-hit", isActive ? "pos-hit--active" : ""].join(" ")}
      style={style}
      // `dblclick` を使わず、いま選ばれている行をもう一度押したときだけ開く。
      //
      // `dblclick` が保証するのは2打が同じ要素に落ちたことだけで、その要素が
      // どの行を描いていたかは見ていない。一覧は仮想化されていて行の DOM は添字で
      // 使い回され、車輪で送るあいだポインタは1px も動かない。OS は打鍵間隔と
      // ポインタの移動だけを見て2打目を数えるので、「行Aを押す → 車輪で送る →
      // 行Bを押す」が行Bのダブルクリックとして届き、1度しか押していない行Bで
      // 棋譜が切り替わる。
      //
      // `detail` は打鍵の連なり（1打目なら1、2打目なら2）。`isActive` は1打目が
      // 選んだ行を指しているので、両方を見れば2打とも同じ行だったかが決まる。
      // 2打目は React が1打目の再描画を流し終えてから来るので、ここで読む
      // `isActive` は1打目の結果
      onClick={(e) => (e.detail >= 2 && isActive ? onAccept() : onSelect())}
    >
      <span className="pos-hit__top">
        <span className="pos-hit__file" title={fileName}>
          {fileName}
        </span>
        <span className={["pos-hit__badge", isSameFile ? "is-same" : "is-switch"].join(" ")}>
          {isSameFile ? "同一" : "切替"}
        </span>
      </span>

      <span className="pos-hit__bottom">
        <span className="pos-hit__path" title={relPath}>
          {relPath}
        </span>
        <span className="pos-hit__meta">
          {tesuu}手目{forks > 0 ? ` / 分岐 ${forks}` : ""}
        </span>
      </span>
    </button>
  );
}

export const PositionHitItem = memo(PositionHitItemBase);
