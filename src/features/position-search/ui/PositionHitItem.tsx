import { memo } from "react";
import "./PositionHitItem.scss";
import type { PositionHit } from "@/entities/search";

type Props = {
  hit: PositionHit;

  relPath: string;
  fileName: string;
  isSameFile: boolean;

  tesuu: number;
  forks: number;

  isActive: boolean;
  disabled: boolean;

  onSelect: () => void;
  onAccept: () => void;

  acceptOnClick?: boolean;
};

function PositionHitItemBase({
  relPath,
  fileName,
  isSameFile,
  tesuu,
  forks,
  isActive,
  disabled,
  onSelect,
  onAccept,
  acceptOnClick = false,
}: Props) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isActive}
      className={[
        "pos-hit",
        isActive ? "pos-hit--active" : "",
        disabled ? "pos-hit--disabled" : "",
      ].join(" ")}
      disabled={disabled}
      onClick={() => {
        if (acceptOnClick) onAccept();
        else onSelect();
      }}
      onDoubleClick={() => {
        if (!acceptOnClick) onAccept();
      }}
    >
      <div className="pos-hit__top">
        <div className="pos-hit__file" title={fileName}>
          {fileName}
        </div>

        <span
          className={[
            "pos-hit__badge",
            isSameFile ? "is-same" : "is-switch",
          ].join(" ")}
        >
          {isSameFile ? "同一" : "切替"}
        </span>
      </div>

      <div className="pos-hit__path" title={relPath}>
        {relPath}
      </div>

      <div className="pos-hit__meta">
        <span className="pos-hit__chip">手数 {tesuu}</span>
        <span className="pos-hit__chip">分岐 {forks}</span>
      </div>
    </button>
  );
}

export const PositionHitItem = memo(PositionHitItemBase);
