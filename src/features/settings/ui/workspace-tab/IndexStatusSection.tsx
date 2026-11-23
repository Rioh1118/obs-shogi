import { useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { SSection, SStats } from "../kit";
import Button from "@/shared/ui/Button/Button";
import SoftBreakText from "@/shared/ui/SoftBreakText";

import { indexHealth, pickWarns, usePositionSearch } from "@/entities/search";
import type { IndexHealth, IndexUiState, IndexWarnPayload } from "@/entities/search";

/** `warn` は直す必要があるもの、`work` は待てば済むもの、`plain` はどちらでもないもの */
type IndexWord = {
  tone: "warn" | "work" | "plain";
  label: string;
};

/**
 * 索引の状態の語。どれを出すかは `indexHealth` が決める。
 *
 * 表で書くのは、状態が増えたときに tsc で止めるため。`default:` のある `switch` は別の語を
 * 黙って出す（`entities/search/lib/indexState.ts` も同じ理由で表にしてある）。
 * `label:` の形は `src/__tests__/screenSpecCoverage.test.ts` が拾う形で、素の値にすると
 * 仕様書との突き合わせから外れる。
 *
 * 引くのは `wordForIndex` の `building` の腕だけにする。`state` から直接引くと、走査に
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
 * 索引の状態の語。具合の判断は `indexHealth` が持つ。
 *
 * 走査に失敗した `Ready` に「準備完了」を出さない。索引は最後に読めたときのまま健全なので
 * 状態は `Ready` だが、それ以降の追加、変更、削除は反映されていない。「準備完了」と出すと、利用者は
 * 索引が最新だと思い込む。読めなかった場所があるときも同じで、検索の0件が「自分の棋譜に
 * 無い」と読める。
 */
function wordForIndex(idx: IndexUiState, health: IndexHealth): IndexWord {
  switch (health) {
    case "notRefreshed":
      return { tone: "warn", label: "更新できていません" };
    case "buildFailed":
      return { tone: "warn", label: "作成できませんでした" };
    case "partiallyUnreadable":
      return { tone: "warn", label: "一部を読めていません" };
    case "partiallyIndexed":
      return { tone: "warn", label: "一部を索引に入れられていません" };
    case "notRefreshedAndPartiallyIndexed":
      return { tone: "warn", label: "更新できず、入れられなかった棋譜もあります" };
    case "partiallyUnreadableAndIndexed":
      return { tone: "warn", label: "読めない場所と、入れられなかった棋譜があります" };
    case "notStarted":
      return { tone: "plain", label: "未作成" };
    case "building":
      return { tone: "work", label: STAGE_LABEL[idx.state].label };
    case "ok":
      return { tone: "plain", label: "準備完了" };
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
        <span className="wsTab__progressLeft">
          {idx.doneFiles.toLocaleString()} / {total.toLocaleString()} files
          <span className="wsTab__pct">{pct}%</span>
        </span>

        {idx.currentPath && (
          <span className="wsTab__progressPath" title={idx.currentPath}>
            {idx.currentPath}
          </span>
        )}
      </div>
    </div>
  );
}

function IndexWarnings({ warns }: { warns: IndexWarnPayload[] }) {
  const shownWarns = useMemo(() => pickWarns(warns, WARN_SLOTS), [warns]);

  return (
    <div className="wsTab__warns">
      <h4 className="wsTab__warnTitle">読み取り警告</h4>

      {/*
        切ったことを言う。「警告 200」のまま一覧が短く終わると、それだけが壊れていると読める
      */}
      {warns.length > shownWarns.length && (
        <p className="wsTab__warnMore">
          {`ほか ${(warns.length - shownWarns.length).toLocaleString()} 件（読めなかった場所を先に、${shownWarns.length} 件だけ表示しています）`}
        </p>
      )}

      <ul className="wsTab__warnList">
        {shownWarns.map((w) => (
          <li key={`${w.kind}:${w.path}:${w.message}`} className="wsTab__warnItem">
            <span className="wsTab__warnMsg">{w.message}</span>
            <span className="wsTab__warnPath">
              <SoftBreakText text={w.path} />
            </span>
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

  // 進捗バーもこの具合で決める。`state` を並べ直すと、状態が増えたときにバーだけ出なくなる
  const health = indexHealth(idx);
  const word = wordForIndex(idx, health);

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
      <p className={`wsTab__word wsTab__word--${word.tone}`}>
        {word.tone === "warn" && <AlertTriangle size={14} aria-hidden="true" />}
        {word.tone === "work" && <Loader2 size={14} className="wsTab__spin" aria-hidden="true" />}
        {word.label}
      </p>

      <SStats
        items={[
          { label: "対象ファイル", value: idx.totalFiles.toLocaleString() },
          {
            // 走査が失敗すると差分を取れていない。0 と描くと索引が最新だと読める
            label: "未同期",
            value: idx.scanFailed ? "確認できていません" : idx.dirtyCount.toLocaleString(),
          },
          {
            // `Ready` のときは対象との差が「検索に出ない棋譜」の数で、警告の一覧のほかに
            // 手掛かりが無い。進行中は据わっている索引の数が出るので、差は未処理の分になる
            label: "索引済み",
            value: `${idx.indexedFiles.toLocaleString()} / ${idx.totalFiles.toLocaleString()}`,
          },
          { label: "警告", value: warns.length.toLocaleString() },
        ]}
      />

      {health === "building" && <IndexProgress idx={idx} />}
      {warns.length > 0 && <IndexWarnings warns={warns} />}
    </SSection>
  );
}
