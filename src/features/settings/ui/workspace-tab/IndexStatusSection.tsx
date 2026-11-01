import { useMemo, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import SSection from "../kit/SSection";
import Button from "@/shared/ui/Button/Button";
import SettingsBadge, { type SettingsBadgeTone } from "../kit/SettingsBadge";
import MiniStat from "./MiniStat";

import { indexHealth, pickWarns, usePositionSearch } from "@/entities/search";
import type { IndexHealth, IndexUiState, IndexWarnPayload } from "@/entities/search";

type IndexBadge = {
  tone: SettingsBadgeTone;
  icon: ReactNode;
  label: string;
};

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
function badgeForIndex(idx: IndexUiState, health: IndexHealth): IndexBadge {
  switch (health) {
    case "notRefreshed":
      return {
        tone: "warn",
        icon: <AlertTriangle size={14} />,
        label: "更新できていません",
      };
    case "buildFailed":
      return {
        tone: "warn",
        icon: <AlertTriangle size={14} />,
        label: "作成できませんでした",
      };
    case "partiallyUnreadable":
      return {
        tone: "warn",
        icon: <AlertTriangle size={14} />,
        label: "一部を読めていません",
      };
    case "partiallyIndexed":
      return {
        tone: "warn",
        icon: <AlertTriangle size={14} />,
        label: "一部を索引に入れられていません",
      };
    case "notRefreshedAndPartiallyIndexed":
      return {
        tone: "warn",
        icon: <AlertTriangle size={14} />,
        label: "更新できず、入れられなかった棋譜もあります",
      };
    case "partiallyUnreadableAndIndexed":
      return {
        tone: "warn",
        icon: <AlertTriangle size={14} />,
        label: "読めない場所と、入れられなかった棋譜があります",
      };
    case "notStarted":
      return { tone: "muted", icon: null, label: "未作成" };
    case "building":
      return {
        tone: "warn",
        icon: <Loader2 size={14} className="wsTab__spin" />,
        label: STAGE_LABEL[idx.state].label,
      };
    case "ok":
      return {
        tone: "accent",
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

function IndexProgress({ idx }: { idx: IndexUiState }) {
  const total = idx.state === "Updating" ? idx.dirtyCount : idx.totalFiles;
  if (total <= 0) return null;

  const pct = percent(idx.doneFiles, total);

  return (
    <div className="wsTab__progress">
      <div className="wsTab__bar">
        <div className="wsTab__barFill" style={{ width: `${pct}%` }} />
      </div>

      <div className="wsTab__progressMeta">
        <div className="wsTab__progressLeft">
          {idx.doneFiles.toLocaleString()} / {total.toLocaleString()} files
          <span className="wsTab__pct">{pct}%</span>
        </div>

        {idx.currentPath && (
          <div className="wsTab__progressPath" title={idx.currentPath}>
            {idx.currentPath}
          </div>
        )}
      </div>
    </div>
  );
}

function IndexWarnings({ warns }: { warns: IndexWarnPayload[] }) {
  const shownWarns = useMemo(() => pickWarns(warns, WARN_SLOTS), [warns]);

  return (
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
        {shownWarns.map((w) => (
          <li key={`${w.kind}:${w.path}:${w.message}`} className="wsTab__warnItem">
            <div className="wsTab__warnMsg">{w.message}</div>
            <div className="wsTab__warnPath" title={w.path}>
              {w.path}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** ワークスペースタブの「状態」の節。局面検索の索引の具合を出す */
export default function IndexStatusSection() {
  const { state: search, clearWarns } = usePositionSearch();

  const idx = search.index;
  const warns = search.warns;

  // 進捗バーもこの具合で決める。`state` を並べ直すと、段が増えたときにバーだけ出なくなる
  const health = indexHealth(idx);
  const badge = badgeForIndex(idx, health);

  return (
    <SSection
      title="状態"
      description="局面検索インデックスの準備状況を表示します。"
      actions={
        warns.length > 0 && (
          <Button size="sm" onClick={clearWarns}>
            警告をクリア
          </Button>
        )
      }
    >
      <div className="wsTab__statusTop">
        <SettingsBadge tone={badge.tone} shape="pill">
          {badge.icon}
          {badge.label}
        </SettingsBadge>

        <div className="wsTab__miniGrid">
          <MiniStat label="対象ファイル">{idx.totalFiles.toLocaleString()}</MiniStat>

          {/* 走査が失敗すると差分を取れていない。0 と描くと索引が最新だと読める */}
          <MiniStat label="未同期">
            {idx.scanFailed ? "確認できていません" : idx.dirtyCount.toLocaleString()}
          </MiniStat>

          {/*
            `Ready` のときは対象との差が「検索に出ない棋譜」の数で、警告の一覧のほかに
            手掛かりが無い。進行中は据わっている索引の数が出るので、差は未処理の分になる
          */}
          <MiniStat label="索引済み">
            {idx.indexedFiles.toLocaleString()} / {idx.totalFiles.toLocaleString()}
          </MiniStat>

          <MiniStat label="警告">{warns.length.toLocaleString()}</MiniStat>
        </div>
      </div>

      {health === "building" && <IndexProgress idx={idx} />}
      {warns.length > 0 && <IndexWarnings warns={warns} />}
    </SSection>
  );
}
