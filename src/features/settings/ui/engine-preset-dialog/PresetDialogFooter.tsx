import Button from "@/shared/ui/Button/Button";
import "./PresetDialogFooter.scss";

export default function PresetDialogFooter({
  onClose,
  onSave,
  saveDisabled = false,
}: {
  onClose: () => void;
  onSave: () => void;
  /** オプションを取得している間は保存させない */
  saveDisabled?: boolean;
}) {
  return (
    <footer className="presetDialog__footer">
      <div className="presetDialog__footerLeft">
        <div className="presetDialog__footerHint">※ 編集中は保存されません。保存で確定します。</div>
      </div>

      <div className="presetDialog__footerRight">
        <Button onClick={onClose}>キャンセル</Button>
        <Button tone="primary" onClick={onSave} disabled={saveDisabled}>
          保存
        </Button>
      </div>
    </footer>
  );
}
