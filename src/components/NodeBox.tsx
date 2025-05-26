import type { ReactNode } from "react";
import "./NodeBox.scss";

type NodeBoxProps = {
  level: number;
  children?: ReactNode;
  handleClick?: () => void;
};

function NodeBox({ level, children, handleClick }: NodeBoxProps) {
  return (
    <div
      className="node-box"
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
