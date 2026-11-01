import { useState } from "react";
import { AlertTriangle, Copy } from "lucide-react";

import SSection from "../kit/SSection";
import Button from "@/shared/ui/Button/Button";

import { useAppConfig } from "@/entities/app-config";
import { copyText } from "@/shared/api/clipboard/copyText";

/** ワークスペースタブの「保存場所」の節。`root_dir` を見せ、打ち込んで確かめてから変える */
export default function WorkspaceRootSection() {
  const { config, isLoading, chooseRootDir } = useAppConfig();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // 設定の画面は `RequireRootDir` の内側にしか出ない
  const rootDir = config!.root_dir!;
  const canChange = confirmText.trim().toLowerCase() === "change";

  const handleChange = async () => {
    const picked = await chooseRootDir({ force: true });
    if (!picked) return;

    // `root_dir` に依存する provider が多いので、個別に差し替えずアプリごと作り直す
    window.location.reload();
  };

  return (
    <SSection
      title="保存場所"
      description="棋譜・ノート・タグなどのデータを保存する“Vault”です。通常は変更しません。"
      actions={
        <div className="wsTab__actions">
          <Button size="sm" onClick={() => void copyText(rootDir)} disabled={isLoading}>
            <Copy size={16} />
            コピー
          </Button>
        </div>
      }
    >
      <div className="wsTab__pathBox">
        <div className="wsTab__pathLabel">root_dir</div>
        <div className="wsTab__pathValue" title={rootDir}>
          {rootDir}
        </div>
      </div>

      <div className="wsTab__danger">
        <AlertTriangle size={16} />
        <div className="wsTab__dangerText">
          変更すると参照先が切り替わるため、変更後はアプリを再読み込みします。
        </div>
      </div>

      <div className="wsTab__dangerActions">
        <Button tone="danger" size="sm" onClick={() => setConfirmOpen(true)}>
          ワークスペースを変更…
        </Button>
      </div>

      {confirmOpen && (
        <div className="wsTab__confirm">
          <div className="wsTab__confirmTitle">ワークスペースを変更</div>
          <div className="wsTab__confirmDesc">
            本当に変更する場合は <b>CHANGE</b> と入力してください。
          </div>

          <input
            className="wsTab__confirmInput"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="CHANGE"
            autoFocus
          />

          <div className="wsTab__confirmButtons">
            <Button size="sm" onClick={() => setConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button
              tone="danger"
              size="sm"
              onClick={handleChange}
              disabled={!canChange}
              isLoading={isLoading}
            >
              変更して再読み込み
            </Button>
          </div>
        </div>
      )}
    </SSection>
  );
}
