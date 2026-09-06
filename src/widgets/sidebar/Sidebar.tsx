import type { ReactNode } from "react";
import "./Sidebar.scss";

/**
 * サイドバーの器。**中身は受け取るだけで、自分では決めない。**
 *
 * 中身はルート（`panel/*`）が差し替える。ここで `Outlet` を持つと、ルート表からも
 * 呼び出し側からも「何が入るのか」が読めなくなる。置き場は `AppLayout` の側。
 */
function Sidebar({ isOpen, children }: { isOpen: boolean; children: ReactNode }) {
  if (!isOpen) return null;
  return <div className={"sidebar"}>{children}</div>;
}

export default Sidebar;
