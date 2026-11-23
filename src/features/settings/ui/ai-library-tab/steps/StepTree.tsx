import type { ReactNode } from "react";

type TreeLineProps = {
  indent?: number;
  label: string;
  note?: string;
  highlight?: boolean;
};

/** フォルダの形の1行。いまの段階で触る所だけを明るくする */
export function TreeLine({ indent = 0, label, note, highlight = false }: TreeLineProps) {
  return (
    <div
      className="setupGuide__treeLine"
      data-highlight={highlight}
      style={{ paddingLeft: `${indent * 1.6}rem` }}
    >
      <span className="setupGuide__treeLabel">{label}</span>
      {note && <span className="setupGuide__treeNote">{note}</span>}
    </div>
  );
}

export function StepTree({ children }: { children: ReactNode }) {
  return <div className="setupGuide__stepTree">{children}</div>;
}
