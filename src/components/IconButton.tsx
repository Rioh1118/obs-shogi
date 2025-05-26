import type { ReactNode } from "react";
import "./IconButton.scss";

function IconButton({
  children,
  handleClick,
  className = "",
}: {
  children: ReactNode;
  handleClick: () => void;
  className?: string;
}) {
  return (
    <button className={`btn__icon ${className}`} onClick={handleClick}>
      {children}
    </button>
  );
}

export default IconButton;
