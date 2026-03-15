type TreeLineProps = {
  indent?: number;
  label: React.ReactNode;
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
      className="aiLibraryTab__treeLine"
      data-highlight={highlight}
      data-dim={dim}
      style={{ paddingLeft: indent * 16 }}
    >
      <span className="aiLibraryTab__treeLabel">{label}</span>
      {note && <span className="aiLibraryTab__treeNote">{note}</span>}
    </div>
  );
}

export function StepTree({ children }: { children: React.ReactNode }) {
  return <div className="aiLibraryTab__stepTree">{children}</div>;
}
