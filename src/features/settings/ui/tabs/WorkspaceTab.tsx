import { useMemo, useState } from "react";
import "./WorkspaceTab.scss";

import { Copy, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import SSection from "../kit/SSection";
import Button from "@/shared/ui/Button/Button";

import { useAppConfig } from "@/entities/app-config";
import { indexHealth, usePositionSearch } from "@/entities/search";
import type { IndexUiState } from "@/entities/search";
import SettingsBadge from "../kit/SettingsBadge";

function percent(done: number, total: number) {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/**
 * 状態バッジ。
 *
 * **走査に失敗した `Ready` を「準備完了」と言わせない。** 索引そのものは
 * 最後に読めたときのまま健全なので状態は `Ready` だが、それ以降の
 * 追加・変更・削除は1件も反映されていない。緑の「準備完了」を出すと、
 * 利用者は索引が最新だと確信する。
 *
 * **読めなかった場所があった回も同じ。** 索引に入っていない棋譜があるのに
 * 緑を出すと、0件が「自分の棋譜に無い」と読める。
 *
 * 具合の判断は `indexHealth` が持つ——画面ごとに旗を並べ直さない。
 */
function badgeForIndex(idx: IndexUiState) {
  const health = indexHealth(idx);
  switch (health) {
    case "notRefreshed":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "更新できていません",
      };
    case "partiallyUnreadable":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "一部を読めていません",
      };
    case "notStarted":
      return { tone: "muted" as const, icon: null, label: "未作成" };
    case "building":
      return {
        tone: "warn" as const,
        icon: <Loader2 size={14} className="wsTab__spin" />,
        label: runningLabel(idx.state),
      };
    case "ok":
      return {
        tone: "accent" as const,
        icon: <CheckCircle2 size={14} />,
        label: "準備完了",
      };
    default: {
      // 具合が増えたら tsc がここで止める。**黙って既定へ落ちない**
      const never: never = health;
      return never;
    }
  }
}

/** 進行中の3つを言い分ける。**どれを出すかは決めない**——決めるのは `indexHealth`。 */
function runningLabel(state: IndexUiState["state"]): string {
  switch (state) {
    case "Restoring":
      return "復元中";
    case "Building":
      return "作成中";
    default:
      return "更新中";
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

  const badge = useMemo(() => badgeForIndex(idx), [idx]);

  const progressTotal = idx.state === "Updating" ? idx.dirtyCount : idx.totalFiles;

  const showProgress =
    (idx.state === "Restoring" || idx.state === "Building" || idx.state === "Updating") &&
    progressTotal > 0;

  const pct = useMemo(() => percent(idx.doneFiles, progressTotal), [idx.doneFiles, progressTotal]);

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
            <Button size="sm" onClick={clearWarns}>
              警告をクリア
            </Button>
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
              <div className="wsTab__miniV">{idx.totalFiles.toLocaleString()}</div>
            </div>

            <div className="wsTab__mini">
              <div className="wsTab__miniK">未同期</div>
              {/*
                **数えられなかったときに 0 と書かない。** 走査が失敗すると
                差分を1件も取れていないので、0 は「無い」ではなく「分からない」。
                0 と描くと、索引が最新だと読める
              */}
              <div className="wsTab__miniV">
                {idx.scanFailed ? "確認できていません" : idx.dirtyCount.toLocaleString()}
              </div>
            </div>

            <div className="wsTab__mini">
              <div className="wsTab__miniK">警告</div>
              <div className="wsTab__miniV">{warns.length.toLocaleString()}</div>
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
                {idx.doneFiles.toLocaleString()} / {progressTotal.toLocaleString()} files
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
              {/*
                **新しい順に出す。** reducer は末尾に積む（`slice(-199)`）ので、
                先頭を読むと**いちばん古い5件が永久に居座る**。起動時の解析警告が
                5件あるだけで、後から届いた走査の失敗が一度も描かれない
              */}
              {warns
                .slice(-5)
                .reverse()
                .map((w, i) => (
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
            <Button size="sm" onClick={onCopyPath} disabled={isLoading}>
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
                onClick={onChangeWorkspace}
                disabled={!canChange}
                isLoading={isLoading}
              >
                変更して再読み込み
              </Button>
            </div>
          </div>
        )}
      </SSection>
    </div>
  );
}
