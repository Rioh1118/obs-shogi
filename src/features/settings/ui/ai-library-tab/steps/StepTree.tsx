import type { ReactNode } from "react";

type TreeLineProps = {
  indent?: number;
  label: string;
  note?: string;
  highlight?: boolean;
  dim?: boolean;
};

export function TreeLine({
  indent = 0,
  label,
  note,
  highlight = false,
  dim = false,
}: TreeLineProps) {
  return (
    <div
      className="setupGuide__treeLine"
      data-highlight={highlight}
      data-dim={dim}
      style={{ paddingLeft: indent * 16 }}
    >
      <span className="setupGuide__treeLabel">{label}</span>
      {note && <span className="setupGuide__treeNote">{note}</span>}
    </div>
  );
}

export function StepTree({ children }: { children: ReactNode }) {
  return <div className="setupGuide__stepTree">{children}</div>;
}
