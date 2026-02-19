import { SButton } from "../ui";
import "./PresetDialogFooter.scss";

export default function PresetDialogFooter({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <footer className="presetDialog__footer">
      <div className="presetDialog__footerLeft">
        <div className="presetDialog__footerHint">
          ※ 編集中は保存されません。保存で確定します。
        </div>
      </div>

      <div className="presetDialog__footerRight">
        <SButton variant="ghost" onClick={onClose}>
          キャンセル
        </SButton>
        <SButton variant="primary" onClick={onSave}>
          保存
        </SButton>
      </div>
    </footer>
  );
}
