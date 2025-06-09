import type { ReactNode } from "react";
import "./NodeBox.scss";

type NodeBoxProps = {
  level: number;
  children?: ReactNode;
  action?: ReactNode;
  isSelected?: boolean;
  handleClick?: () => void;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
};

function NodeBox({
  level,
  children,
  action,
  isSelected,
  handleClick,
  onMouseEnter,
  onMouseLeave,
}: NodeBoxProps) {
  return (
    <div
      className={`node-box ${isSelected ? "node-box__selected" : ""}`}
      style={{
        paddingLeft: `${2 + level * 1.3}rem`,
        cursor: "pointer",
      }}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="node-box__content">
        <div className="node-box__main">{children}</div>
        {action && <div className="node-box__actions">{action}</div>}
      </div>
    </div>
  );
}

export default NodeBox;
