import { DROP_ID, type DropData } from "@/widgets/lib/dnd";
import { useDroppable } from "@dnd-kit/core";

function ScrollDropZone({
  rootPath,
  children,
}: {
  rootPath: string | null;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: DROP_ID.blank,
    disabled: !rootPath,
    data: {
      kind: "drop",
      destDir: rootPath ?? "",
      via: "blank",
    } satisfies DropData,
  });

  return (
    <div className="file-tree__scroll" ref={setNodeRef}>
      {children}
    </div>
  );
}

export default ScrollDropZone;
