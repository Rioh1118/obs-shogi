import { useMemo, useState } from "react";
import "./WorkspaceTab.scss";

import { Copy, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import SSection from "../kit/SSection";
import SButton from "../kit/SButton";

import { useAppConfig } from "@/entities/app-config";
import { usePositionSearch } from "@/entities/search";
import SettingsBadge from "../kit/SettingsBadge";

function percent(done: number, total: number) {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function badgeForIndexState(
  s: "Empty" | "Restoring" | "Building" | "Ready" | "Updating",
) {
  switch (s) {
    case "Ready":
      return {
        tone: "accent" as const,
        icon: <CheckCircle2 size={14} />,
        label: "準備完了",
      };
    case "Building":
      return {
        tone: "warn" as const,
        icon: <Loader2 size={14} className="wsTab__spin" />,
        label: "作成中",
      };
    case "Updating":
      return {
        tone: "warn" as const,
        icon: <Loader2 size={14} className="wsTab__spin" />,
        label: "更新中",
      };
    case "Restoring":
      return {
        tone: "muted" as const,
        icon: <Loader2 size={14} className="wsTab__spin" />,
        label: "復元中",
      };
    case "Empty":
    default:
      return { tone: "muted" as const, icon: null, label: "未作成" };
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 必要なら後で clipboard plugin に
  }
}

export default function WorkspaceTab() {
  const { config, isLoading, error, chooseRootDir } = useAppConfig();
  const { state: search, clearWarns } = usePositionSearch();

  const rootDir = config!.root_dir!;
  const idx = search.index; // ←あなたの state 形
  const warns = search.warns; // ←あなたの state 形

  const badge = useMemo(() => badgeForIndexState(idx.state), [idx.state]);

  const showProgress =
    (idx.state === "Restoring" ||
      idx.state === "Building" ||
      idx.state === "Updating") &&
    idx.totalFiles > 0;

  const pct = useMemo(
    () => percent(idx.doneFiles, idx.totalFiles),
    [idx.doneFiles, idx.totalFiles],
  );

  // root_dir 変更の儀式
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canChange = confirmText.trim().toLowerCase() === "change";

  const onCopyPath = async () => {
    await copyText(rootDir);
  };

  const onChangeWorkspace = async () => {
    const picked = await chooseRootDir({ force: true });
    if (!picked) return;

    // いろんな Provider が root_dir に依存してるので、確実性優先でリロード
    window.location.reload();
  };

  return (
    <div className="wsTab">
      <SSection
        title="状態"
        description="局面検索インデックスの準備状況を表示します。"
        actions={
          warns.length > 0 ? (
            <SButton variant="ghost" size="sm" onClick={clearWarns}>
              警告をクリア
            </SButton>
          ) : null
        }
      >
        {error && (
          <div className="wsTab__error" role="alert">
            {error}
          </div>
        )}

        <div className="wsTab__statusTop">
          <SettingsBadge tone={badge.tone} shape="pill">
            {badge.icon}
            {badge.label}
          </SettingsBadge>

          <div className="wsTab__miniGrid">
            <div className="wsTab__mini">
              <div className="wsTab__miniK">対象ファイル</div>
              <div className="wsTab__miniV">
                {idx.totalFiles.toLocaleString()}
              </div>
            </div>

            <div className="wsTab__mini">
              <div className="wsTab__miniK">未同期</div>
              <div className="wsTab__miniV">
                {idx.dirtyCount.toLocaleString()}
              </div>
            </div>

            <div className="wsTab__mini">
              <div className="wsTab__miniK">警告</div>
              <div className="wsTab__miniV">
                {warns.length.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {showProgress && (
          <div className="wsTab__progress">
            <div className="wsTab__bar">
              <div className="wsTab__barFill" style={{ width: `${pct}%` }} />
            </div>

            <div className="wsTab__progressMeta">
              <div className="wsTab__progressLeft">
                {idx.doneFiles.toLocaleString()} /{" "}
                {idx.totalFiles.toLocaleString()} files
                <span className="wsTab__pct">{pct}%</span>
              </div>

              {idx.currentPath && (
                <div className="wsTab__progressPath" title={idx.currentPath}>
                  {idx.currentPath}
                </div>
              )}
            </div>
          </div>
        )}

        {warns.length > 0 && (
          <div className="wsTab__warnBox">
            <div className="wsTab__warnTitle">
              <AlertTriangle size={16} />
              読み取り警告
            </div>

            <ul className="wsTab__warnList">
              {warns.slice(0, 5).map((w, i) => (
                <li key={`${w.path}:${i}`} className="wsTab__warnItem">
                  <div className="wsTab__warnMsg">{w.message}</div>
                  <div className="wsTab__warnPath" title={w.path}>
                    {w.path}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SSection>

      <SSection
        title="保存場所"
        description="棋譜・ノート・タグなどのデータを保存する“Vault”です。通常は変更しません。"
        actions={
          <div className="wsTab__actions">
            <SButton
              variant="ghost"
              size="sm"
              onClick={onCopyPath}
              disabled={isLoading}
            >
              <Copy size={16} />
              コピー
            </SButton>
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
          <SButton
            variant="danger"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            ワークスペースを変更…
          </SButton>
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
              <SButton
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOpen(false)}
              >
                キャンセル
              </SButton>
              <SButton
                variant="danger"
                size="sm"
                onClick={onChangeWorkspace}
                disabled={!canChange}
                isLoading={isLoading}
              >
                変更して再読み込み
              </SButton>
            </div>
          </div>
        )}
      </SSection>
    </div>
  );
}
