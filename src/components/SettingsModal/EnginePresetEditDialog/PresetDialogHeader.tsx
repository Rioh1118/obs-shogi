import "./PresetDialogHeader.scss";

export default function PresetDialogHeader({ title }: { title: string }) {
  return (
    <header className="presetDialog__header">
      <div className="presetDialog__titles">
        <div className="presetDialog__title">{title}</div>
        <div className="presetDialog__subtitle">
          保存時にプリセットが更新され、必要なら自動でエンジンが再起動されます。
        </div>
      </div>
    </header>
  );
}
