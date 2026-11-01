import { useEffect, useMemo, useState } from "react";
import "./WorkspaceTab.scss";

import { Copy, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import SSection from "../kit/SSection";
import Button from "@/shared/ui/Button/Button";

import { useAppConfig } from "@/entities/app-config";
import { indexHealth, pickWarns, usePositionSearch } from "@/entities/search";
import type { IndexHealth, IndexUiState } from "@/entities/search";
import { acceptsManualCheck, useUpdater } from "@/entities/updater";
import type { ManualCheckResult } from "@/entities/updater";
import { getAppVersion } from "@/shared/api/app/appVersion";
import { copyText } from "@/shared/api/clipboard/copyText";
import SettingsBadge from "../kit/SettingsBadge";

function percent(done: number, total: number) {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/**
 * 索引の状態バッジ。具合の判断は `indexHealth` が持つ。
 *
 * 走査に失敗した `Ready` に「準備完了」を出さない。索引は最後に読めたときのまま健全なので
 * 状態は `Ready` だが、それ以降の追加、変更、削除は反映されていない。緑を出すと、利用者は
 * 索引が最新だと思い込む。読めなかった場所があるときも同じで、検索の0件が「自分の棋譜に
 * 無い」と読める。
 */
function badgeForIndex(idx: IndexUiState, health: IndexHealth) {
  switch (health) {
    case "notRefreshed":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "更新できていません",
      };
    case "buildFailed":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "作成できませんでした",
      };
    case "partiallyUnreadable":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "一部を読めていません",
      };
    case "partiallyIndexed":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "一部を索引に入れられていません",
      };
    case "notRefreshedAndPartiallyIndexed":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "更新できず、入れられなかった棋譜もあります",
      };
    case "partiallyUnreadableAndIndexed":
      return {
        tone: "warn" as const,
        icon: <AlertTriangle size={14} />,
        label: "読めない場所と、入れられなかった棋譜があります",
      };
    case "notStarted":
      return { tone: "muted" as const, icon: null, label: "未作成" };
    case "building":
      return {
        tone: "warn" as const,
        icon: <Loader2 size={14} className="wsTab__spin" />,
        label: STAGE_LABEL[idx.state].label,
      };
    case "ok":
      return {
        tone: "accent" as const,
        icon: <CheckCircle2 size={14} />,
        label: "準備完了",
      };
    default: {
      // 具合が増えたら tsc がここで止める
      const never: never = health;
      return never;
    }
  }
}

/**
 * 索引の段の語。どれを出すかは `indexHealth` が決める。
 *
 * 表で書くのは、段が増えたときに tsc で止めるため。`default:` のある `switch` は別の語を
 * 黙って出す（`entities/search/lib/indexState.ts` も同じ理由で表にしてある）。
 * `label:` の形は `src/__tests__/screenSpecCoverage.test.ts` が拾う形で、素の値にすると
 * 仕様書との突き合わせから外れる。
 *
 * 引くのは `badgeForIndex` の `building` の腕だけにする。`state` から直接引くと、走査に
 * 失敗した `Ready` にも「準備完了」を出す。`Empty` と `Ready` の欄は表を埋めるためにある。
 */
const STAGE_LABEL: Record<IndexUiState["state"], { label: string }> = {
  Restoring: { label: "復元中" },
  Building: { label: "作成中" },
  Updating: { label: "更新中" },
  Empty: { label: "未作成" },
  Ready: { label: "準備完了" },
};

/** 警告の一覧に出す件数。増やすと状態の要約が押し出される */
const WARN_SLOTS = 5;

/**
 * 手で押した確認の結果の文。
 *
 * 見つかっても取得のボタンを置かない。更新のカードは設定モーダルの下に出る（重なりの順は
 * `docs/spec/design-language.md`）ので、ここに置くと進捗と失敗の出る面が2つになる。
 * 失敗に「もう一度」を出さない。すぐ上の「更新を確認」と同じ動作のボタンが2つ並ぶ。
 */
function manualCheckText(result: ManualCheckResult): string {
  switch (result.kind) {
    case "upToDate":
      return "最新版を使っています";
    case "found":
      return `新しいバージョン v${result.version} が公開されています。この画面を閉じると案内が出ます。`;
    case "foundButSkipped":
      return `新しいバージョン v${result.version} がありますが、この版は飛ばす設定になっています。`;
    case "failed":
      return "更新を確認できませんでした。通信を確認して、もう一度お試しください。";
  }
}

/**
 * 最後に確認できた時刻の文。
 *
 * 一度も確認できていないときも空欄にしない。確認の失敗は画面に出さない（理由は
 * `entities/updater` の provider の `runCheck`）ので、時刻が古いまま止まっていることが、
 * 失敗し続けていることの唯一の手掛かりになる。
 */
function lastCheckedText(ms: number | null): string {
  if (ms === null) return "まだ確認できていません";
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WorkspaceTab() {
  const { config, isLoading, error, chooseRootDir } = useAppConfig();
  const { state: search, clearWarns } = usePositionSearch();

  const rootDir = config!.root_dir!;
  const idx = search.index;
  const warns = search.warns;

  // 進捗バーもこの具合で決める。`state` を並べ直すと、段が増えたときにバーだけ出なくなる
  const health = indexHealth(idx);
  const badge = badgeForIndex(idx, health);

  const shownWarns = useMemo(() => pickWarns(warns, WARN_SLOTS), [warns]);

  const progressTotal = idx.state === "Updating" ? idx.dirtyCount : idx.totalFiles;

  const showProgress = health === "building" && progressTotal > 0;

  const pct = useMemo(() => percent(idx.doneFiles, progressTotal), [idx.doneFiles, progressTotal]);

  const { status, persisted, manualCheck, isChecking, checkNow, unskip } = useUpdater();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getAppVersion()
      .then((v) => {
        if (alive) setAppVersion(v);
      })
      // 版が取れないのは webview から `getVersion` を呼べないときだけで、利用者にできることが
      // 無い。出さずに「—」のままにする
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canChange = confirmText.trim().toLowerCase() === "change";

  const onChangeWorkspace = async () => {
    const picked = await chooseRootDir({ force: true });
    if (!picked) return;

    // `root_dir` に依存する provider が多いので、個別に差し替えずアプリごと作り直す
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
              {/* 走査が失敗すると差分を取れていない。0 と描くと索引が最新だと読める */}
              <div className="wsTab__miniV">
                {idx.scanFailed ? "確認できていません" : idx.dirtyCount.toLocaleString()}
              </div>
            </div>

            <div className="wsTab__mini">
              {/*
                `Ready` のときは対象との差が「検索に出ない棋譜」の数で、警告の一覧のほかに
                手掛かりが無い。進行中は据わっている索引の数が出るので、差は未処理の分になる
              */}
              <div className="wsTab__miniK">索引済み</div>
              <div className="wsTab__miniV">
                {idx.indexedFiles.toLocaleString()} / {idx.totalFiles.toLocaleString()}
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

            {/*
              切ったことを言う。「警告 200」のまま一覧が短く終わると、それだけが壊れていると読める
            */}
            {warns.length > shownWarns.length && (
              <div className="wsTab__warnMore">
                {`ほか ${(warns.length - shownWarns.length).toLocaleString()} 件（読めなかった場所を先に、${shownWarns.length} 件だけ表示しています）`}
              </div>
            )}

            <ul className="wsTab__warnList">
              {shownWarns.map((w, i) => (
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

      <SSection
        title="更新"
        description="アプリ本体の更新を確認します。起動のたびに一度だけ自動で確認します。"
        actions={
          <Button
            size="sm"
            onClick={() => void checkNow()}
            disabled={isChecking || !acceptsManualCheck(status)}
          >
            更新を確認
          </Button>
        }
      >
        <div className="wsTab__miniGrid">
          <div className="wsTab__mini">
            <div className="wsTab__miniK">現在のバージョン</div>
            <div className="wsTab__miniV">{appVersion ?? "—"}</div>
          </div>

          <div className="wsTab__mini">
            <div className="wsTab__miniK">最後に確認できた</div>
            <div className="wsTab__miniV wsTab__miniV--plain">
              {lastCheckedText(persisted?.lastCheckedMs ?? null)}
            </div>
          </div>
        </div>

        {manualCheck && (
          <div className="wsTab__updateResult" role="status">
            {manualCheckText(manualCheck)}
          </div>
        )}

        {/*
          確認の結果と別に常に出す。更新が来ない理由が、確認の故障か飛ばす設定かを見分けるため
        */}
        {persisted?.skippedVersion && (
          <div className="wsTab__updateSkipped">
            <div className="wsTab__updateSkippedText">
              v{persisted.skippedVersion} を飛ばす設定になっています
            </div>
            <Button size="sm" onClick={() => void unskip()}>
              解除
            </Button>
          </div>
        )}
      </SSection>
    </div>
  );
}
