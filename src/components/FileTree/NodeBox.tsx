import type { ReactNode } from "react";
import "./NodeBox.scss";

type NodeBoxProps = {
  level: number;
  children?: ReactNode;
  isSelected?: boolean;
  handleClick?: () => void;
};

function NodeBox({ level, children, isSelected, handleClick }: NodeBoxProps) {
  return (
    <div
      className={`node-box ${isSelected ? "node-box__selected" : ""}`}
      style={{
        paddingLeft: `${2 + level * 1.3}rem`,
        cursor: "pointer",
      }}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

export default NodeBox;
