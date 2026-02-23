import { Outlet } from "react-router";
import "./Sidebar.scss";

function Sidebar({ isOpen }: { isOpen: boolean }) {
  if (!isOpen) return null;
  return (
    <div className={"sidebar"}>
      <Outlet />
    </div>
  );
}

export default Sidebar;
