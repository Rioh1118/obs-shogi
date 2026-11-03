import "./DirectoryToggleIcon.scss";

function DirectoryToggleIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span className={`chevron ${isExpanded ? "chevron--expanded" : "chevron--collapsed"}`}>
      &#8250;
    </span>
  );
}
export default DirectoryToggleIcon;
