import { useEffect, useMemo, useRef } from "react";
import { useDynamicRowHeight } from "react-window";
import { useAppConfig } from "@/entities/app-config";
import "./PositionSearchHitList.scss";
import { useGame } from "@/entities/game";
import type { PositionHit } from "@/entities/search";
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
};

export default function PositionSearchHitList({
  hits,
  activeIndex,
  onActiveIndexChange,
  onAccept,
  isSearching,
  error,
  resolveAbsPath,
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
        <div className="pos-search__empty" role="status" aria-live="polite">
          {isSearching
            ? "検索結果を受信中…"
            : error
              ? "検索に失敗しました"
              : "一致する棋譜がありません"}
        </div>
      </section>
    );
  }

  return (
    <section className="pos-search__results" aria-label="検索結果">
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
