import { memo, type CSSProperties, type Ref } from "react";
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
  ref?: Ref<HTMLButtonElement>;

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
  ref,
  onSelect,
  onAccept,
}: Props) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={isActive}
      aria-posinset={posInSet}
      aria-setsize={setSize}
      // 選択している行だけが Tab の止まり場になる。フォーカスと選択が割れると、
      // 銅のリングと銅の面が別の行を指し、Enter で開くのは面のほうになる
      tabIndex={isActive ? 0 : -1}
      className={["pos-hit", isActive ? "pos-hit--active" : ""].join(" ")}
      style={style}
      onClick={onSelect}
      onDoubleClick={onAccept}
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
