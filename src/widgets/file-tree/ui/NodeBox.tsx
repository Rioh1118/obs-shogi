import type { ComponentPropsWithRef, ReactNode } from "react";
import "./NodeBox.scss";

type NodeBoxProps = {
  level: number;
  children?: ReactNode;
  action?: ReactNode;
  isSelected?: boolean;
  handleClick?: () => void;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
} & ComponentPropsWithRef<"div">;

function NodeBox({
  level,
  children,
  action,
  isSelected,
  className,
  style,
  handleClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  ref,
  ...rest
}: NodeBoxProps) {
  return (
    <div
      ref={ref}
      className={`node-box ${isSelected ? "node-box__selected" : ""} ${className ?? ""}`}
      style={{
        paddingLeft: `${2 + level * 1.3}rem`,
        cursor: "pointer",
        ...style,
      }}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
      {...rest}
    >
      <div className="node-box__content">
        <div className="node-box__main">{children}</div>
        {action && <div className="node-box__actions">{action}</div>}
      </div>
    </div>
  );
}

export default NodeBox;
