import "./PositionSearchStatusBar.scss";

import type { IndexHealth } from "@/entities/search";

type Props = {
  hitsCount: number;
  statusText: string;
  /** 索引の具合。**旗を並べ直さない**——順を持つのは `indexHealth` 1つ */
  indexHealth: IndexHealth;
  /** この検索が走っている間に索引が動いた。索引の具合とは別の話 */
  sessionStale: boolean;
  error: string | null;
};

/**
 * 索引の具合を1語で言う。`null` は「言うことが無い」。
 *
 * **待てば直るものと、直しに行くべきものを同じ語にしない。**
 * 走査が失敗した回に「更新待ち」と出すと、利用者は待ち続ける——
 * 再試行の導線は無いので、待っても何も起きない。
 */
function indexNote(health: IndexHealth): string | null {
  switch (health) {
    case "building":
      return "索引の更新待ち";
    case "notRefreshed":
      return "索引を更新できていません";
    case "partiallyIndexed":
      return "一部を索引に入れられていません";
    case "notRefreshedAndPartiallyIndexed":
      return "更新できず、入れられなかった棋譜もあります";
    case "partiallyUnreadableAndIndexed":
      return "読めない場所と、入れられなかった棋譜があります";
    case "buildFailed":
      return "索引を作れませんでした";
    case "partiallyUnreadable":
      return "読めなかった場所があります";
    case "notStarted":
      return "索引がありません";
    case "ok":
      return null;
    default: {
      // 具合が増えたら tsc がここで止める。**黙って既定へ落ちない**
      const never: never = health;
      return never;
    }
  }
}

export default function PositionSearchStatusBar({
  hitsCount,
  statusText,
  indexHealth,
  sessionStale,
  error,
}: Props) {
  const note = indexNote(indexHealth);

  return (
    <section className="pos-search-status" aria-label="検索状態">
      <span className="pos-search-status__item">一致: {hitsCount}</span>
      <span className="pos-search-status__item">{statusText}</span>

      {note && (
        <span className="pos-search-status__item pos-search-status__item--warn">{note}</span>
      )}

      {/* 索引そのものは健全でも、この検索の途中で動いていれば結果は取りこぼす */}
      {!note && sessionStale && (
        <span className="pos-search-status__item pos-search-status__item--warn">
          検索中に索引が動きました
        </span>
      )}

      {error && (
        <span className="pos-search-status__item pos-search-status__item--error">{error}</span>
      )}
    </section>
  );
}
