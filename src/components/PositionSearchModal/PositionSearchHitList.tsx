import { useEffect, useMemo, useRef } from "react";
import type { PositionHit } from "@/commands/search/types";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { useGame } from "@/contexts/GameContext";
import "./PositionSearchHitList.scss";
import { toRelPath } from "@/utils/path";

type Props = {
  hits: PositionHit[];
  activeIndex: number;
  onActiveIndexChange: (next: number) => void;
  onAccept: (hit: PositionHit) => void;
  isSearching: boolean;
  error: string | null;
  resolveAbsPath: (hit: PositionHit) => string | null; // ← Modalから渡す（責務分離）
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
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { config } = useAppConfig();
  const { state: gameState } = useGame();

  const rootDir = config?.root_dir ?? null;
  const currentAbs = gameState.loadedAbsPath ?? null;

  const rows = useMemo(() => {
    return hits.map((hit, idx) => {
      const abs = resolveAbsPath(hit);
      const rel = abs ? toRelPath(abs, rootDir) : "path unknown";

      const isSame = abs && currentAbs ? abs === currentAbs : false;

      return {
        idx,
        hit,
        absPath: abs,
        relPath: rel,
        isSameFile: isSame,
        tesuu: hit.cursor.tesuu,
        forks: hit.cursor.fork_pointers.length,
        id: `pos-search-opt-${hit.occ.file_id}-${hit.occ.gen}-${hit.occ.node_id}-${idx}`,
      };
    });
  }, [hits, resolveAbsPath, rootDir, currentAbs]);

  const activeId = rows[activeIndex]?.id;

  useEffect(() => {
    const el = optionRefs.current[activeIndex];
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <section className="pos-search__results" aria-label="検索結果">
      <div
        className="pos-search__list"
        role="listbox"
        aria-activedescendant={activeId}
      >
        {rows.length === 0 ? (
          <div className="pos-search__empty" role="status" aria-live="polite">
            {isSearching
              ? "検索結果を受信中…"
              : error
                ? "検索に失敗しました"
                : "一致する棋譜がありません"}
          </div>
        ) : (
          rows.map((row) => {
            const isActive = row.idx === activeIndex;
            return (
              <button
                key={row.id}
                id={row.id}
                ref={(el) => {
                  optionRefs.current[row.idx] = el;
                }}
                type="button"
                role="option"
                aria-selected={isActive}
                className={[
                  "pos-search__item",
                  isActive ? "pos-search__item--active" : "",
                ].join(" ")}
                onMouseEnter={() => onActiveIndexChange(row.idx)}
                onClick={() => onAccept(row.hit)}
                disabled={isSearching}
              >
                <div className="pos-search__rowTop">
                  <div className="pos-search__path">{row.relPath}</div>
                  <span
                    className={[
                      "pos-search__badge",
                      row.isSameFile ? "is-same" : "is-switch",
                    ].join(" ")}
                  >
                    {row.isSameFile ? "同一" : "切替"}
                  </span>
                </div>

                <div className="pos-search__rowMeta">
                  <span className="pos-search__chip">手数 {row.tesuu}</span>
                  <span className="pos-search__chip">分岐 {row.forks}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
