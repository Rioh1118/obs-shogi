import type { ReactNode } from "react";

import { cx } from "@/features/settings/lib/cx";

type Props = {
  label: string;
  /** 数字でなく文で出す値か */
  plain?: boolean;
  children: ReactNode;
};

/** ワークスペースタブの見出しつきの値。スタイルは `WorkspaceTab.scss` が持つ */
export default function MiniStat({ label, plain, children }: Props) {
  return (
    <div className="wsTab__mini">
      <div className="wsTab__miniK">{label}</div>
      <div className={cx("wsTab__miniV", plain && "wsTab__miniV--plain")}>{children}</div>
    </div>
  );
}
