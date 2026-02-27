import { useEffect, useMemo, useRef } from "react";
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
  acceptOnClick?: boolean;
};

export default function PositionSearchHitList({
  hits,
  activeIndex,
  onActiveIndexChange,
  onAccept,
  isSearching,
  error,
  resolveAbsPath,
  acceptOnClick = false,
}: Props) {
  const { config } = useAppConfig();
  const { state: gameState } = useGame();

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
      isSearching,
      rootDir,
      currentAbs,
      relCache: relCacheRef.current,
      resolveAbsPath,
      onActiveIndexChange,
      onAccept,
      acceptOnClick,
    }),
    [
      hits,
      activeIndex,
      isSearching,
      rootDir,
      currentAbs,
      resolveAbsPath,
      onActiveIndexChange,
      onAccept,
      acceptOnClick,
    ],
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
      <div className="pos-search__listVirtual" role="listbox">
        <VirtualList<HitRowProps>
          rowCount={hits.length}
          rowHeight={78}
          rowComponent={VirtualHitRow}
          rowProps={rowProps}
          followIndex={activeIndex}
          followAlign="auto"
          followBehavior="instant"
          overscanCount={8}
        />
      </div>
    </section>
  );
}
