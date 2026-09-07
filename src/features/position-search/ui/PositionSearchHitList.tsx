import { useEffect, useMemo, useRef } from "react";
import { useDynamicRowHeight } from "react-window";
import { useAppConfig } from "@/entities/app-config";
import "./PositionSearchHitList.scss";
import { useGame } from "@/entities/game";
import type { IndexHealth, PositionHit } from "@/entities/search";
import { VirtualHitRow, type HitRowProps } from "./VirtualHitRow";
import { VirtualList } from "../lib/virtual/VirtualList";

type Props = {
  hits: PositionHit[];
  activeIndex: number;
  onActiveIndexChange: (next: number) => void;
  onAccept: (hit: PositionHit) => void;
  isSearching: boolean;
  error: string | null;
  resolveAbsPath: (hit: PositionHit) => string | null;

  /** 検索する局面があるか。無ければ検索はそもそも走らない */
  hasQuery: boolean;
  /**
   * 索引の具合。**0件の理由がここで変わる。**
   *
   * 旗を並べ直さない——並べる順は `indexHealth` が1つ持っている。
   */
  indexHealth: IndexHealth;
  /** この検索が走っている間に索引が動いた。索引の具合とは別の話 */
  sessionStale: boolean;
};

/**
 * 0件の理由を言う。
 *
 * **索引の具合を伏せて「一致する棋譜がありません」と言い切らない。**
 * 走査が完走していない回も、読めなかった場所があった回も、索引に無いだけで
 * ディスクには在る。裸で断言すると、利用者は自分の棋譜に無いと読んで探すのをやめる。
 */
function emptyReason(health: IndexHealth, sessionStale: boolean): string {
  switch (health) {
    case "notRefreshed":
      return "一致する棋譜がありません（索引を更新できていないので、最近の追加は反映されていません）";
    case "buildFailed":
      return "索引を作れなかったので検索できません（ワークスペースを読めるか確かめてください）";
    case "partiallyIndexed":
      return "一致する棋譜がありません（索引に入れられなかった棋譜があるので、そこには当たりません）";
    case "notRefreshedAndPartiallyIndexed":
      return "一致する棋譜がありません（索引を更新できておらず、入れられなかった棋譜もあります）";
    case "partiallyUnreadableAndIndexed":
      return "一致する棋譜がありません（読めなかった場所と、索引に入れられなかった棋譜の両方があります）";
    case "partiallyUnreadable":
      return "一致する棋譜がありません（読み取れなかった場所があるので、そこの棋譜は検索に出ないか、最新でない可能性があります）";
    case "building":
      return "一致する棋譜がありません（索引の更新中なので、増える場合があります）";
    case "notStarted":
      return "一致する棋譜がありません（索引がまだ作られていません）";
    case "ok":
      return sessionStale
        ? "一致する棋譜がありません（検索中に索引が動いたので、取り直すと変わる場合があります）"
        : "一致する棋譜がありません";
    default: {
      // 具合が増えたら tsc がここで止める。**黙って既定へ落ちない**
      const never: never = health;
      return never;
    }
  }
}

export default function PositionSearchHitList({
  hits,
  activeIndex,
  onActiveIndexChange,
  onAccept,
  isSearching,
  error,
  resolveAbsPath,
  hasQuery,
  indexHealth,
  sessionStale,
}: Props) {
  const { config } = useAppConfig();
  const { state: gameState } = useGame();

  // 行の高さは `PositionHitItem.scss` だけが決める。ここで固定値を持つと、
  // 文字サイズや余白を動かしたときに**カードだけが伸びてスロットからはみ出し**、
  // 次の行が上のカードの裾を覆う（行は絶対配置なので、はみ出しても押しのけない）。
  // 実測に任せておけば、両者がずれるという状態自体が作れない。
  //
  // `defaultRowHeight` は実測が付くまでの見積もりにしか使われないので、
  // 現物とぴったり合っている必要はない。スクロールバーの長さが最初の1フレームだけ
  // ずれる以外の影響は無い。
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 72 });

  const rootDir = config?.root_dir ?? null;
  const currentAbs = gameState.loadedAbsPath ?? null;

  const relCacheRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    relCacheRef.current = new Map();
  }, [rootDir]);

  const rowProps = useMemo<HitRowProps>(
    () => ({
      hits,
      activeIndex,
      rootDir,
      currentAbs,
      relCache: relCacheRef.current,
      resolveAbsPath,
      onActiveIndexChange,
      onAccept,
    }),
    [hits, activeIndex, rootDir, currentAbs, resolveAbsPath, onActiveIndexChange, onAccept],
  );

  if (hits.length === 0) {
    return (
      <section className="pos-search__results" aria-label="検索結果">
        <div
          className={["pos-search__empty", error ? "pos-search__empty--error" : ""].join(" ")}
          role="status"
          aria-live="polite"
        >
          {/* 「検索していない」と「検索して0件だった」を同じ文言にしない。
              状態行が「待機中」と言っているのに一覧が「一致しない」と言うと、
              どちらが起きたのか読み手が決められない */}
          {!hasQuery
            ? "検索する局面がありません"
            : isSearching
              ? "検索結果を受信中…"
              : error
                ? `検索に失敗しました: ${error}`
                : emptyReason(indexHealth, sessionStale)}
        </div>
      </section>
    );
  }

  return (
    <section className="pos-search__results" aria-label="検索結果">
      {/* 途中で失敗しても、届いたぶんは出したまま残す。ただし黙って残すと
          「これで全部」と読めるので、打ち切られたことをここで言う */}
      {error && (
        <div className="pos-search__notice" role="status" aria-live="polite">
          途中で失敗したので、これで全部とは限りません: {error}
        </div>
      )}

      {/* listbox は行を実際に収めている器（＝スクロールする要素）に置く。
          包む div に置くと、行とのあいだに要素が挟まって option の持ち主でなくなる */}
      <VirtualList<HitRowProps>
        className="pos-search__listVirtual"
        role="listbox"
        aria-label="検索結果"
        // 選択している行が画面外へ出て消えるあいだ、焦点を預かる先。
        // ここが無いと焦点が <body> へ落ち、`Modal` の引き戻しが別の行を掴む
        tabIndex={-1}
        rowCount={hits.length}
        rowHeight={rowHeight}
        rowComponent={VirtualHitRow}
        rowProps={rowProps}
        followIndex={activeIndex}
        followAlign="auto"
        followBehavior="instant"
        overscanCount={8}
      />
    </section>
  );
}
