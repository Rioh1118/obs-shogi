import "./FileIcon.scss";

interface FileIconProps {
  type: "folder" | "document" | "kif-file";
  isOpen?: boolean;
}

export default function FileIcon({ type, isOpen }: FileIconProps) {
  function getIcon() {
    switch (type) {
      case "folder":
        return isOpen ? "📂" : "📁";
      case "kif-file":
        return "☗";
      case "document":
        return "📄";
    }
  }

  return (
    <span className="file-icon" role="img" aria-hidden="true">
      {getIcon()}
    </span>
  );
}
