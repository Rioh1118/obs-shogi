import { useState } from "react";
import { Copy } from "lucide-react";

import { SField, SInput, SPath, SSection } from "../kit";
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
    >
      <SField label="root_dir">
        <div className="wsTab__pathRow">
          <SPath path={rootDir} />
          <Button size="sm" onClick={() => void copyText(rootDir)} disabled={isLoading}>
            <Copy size={13} aria-hidden="true" />
            コピー
          </Button>
        </div>
      </SField>

      <div className="wsTab__change">
        <p className="wsTab__changeNote">
          変更すると参照先が切り替わるため、変更後はアプリを再読み込みします。
        </p>
        <Button size="sm" className="wsTab__changeButton" onClick={() => setConfirmOpen(true)}>
          ワークスペースを変更…
        </Button>
      </div>

      {confirmOpen && (
        <div className="wsTab__confirm">
          <h4 className="wsTab__confirmTitle">ワークスペースを変更</h4>
          <p className="wsTab__confirmDesc">
            本当に変更する場合は <b>CHANGE</b> と入力してください。
          </p>

          <SInput
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="CHANGE"
            aria-label="確認の入力"
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
