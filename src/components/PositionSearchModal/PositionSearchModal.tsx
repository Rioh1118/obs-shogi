import { useEffect, useRef, useState } from "react";

import { useURLParams } from "@/hooks/useURLParams";
import { usePosition } from "@/contexts/PositionContext";
import { usePositionSearch } from "@/contexts/PositionSearchContext";
import { Search, CornerDownLeft, Loader2 } from "lucide-react";

import type { PositionHit } from "@/commands/search/types";
import "./PositionSeachModal.scss";
import Modal from "../Modal";
import { usePositionHitNavigation } from "@/hooks/usePositionHitNavigation";

function formatHitLabel(hit: PositionHit) {
  const { occ, cursor } = hit;
  return `#${occ.file_id}:${occ.gen}@${occ.node_id}  tesuu=${cursor.tesuu} cursor=${cursor.fork_pointers.length}`;
}

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { currentSfen } = usePosition();

  const {
    state,
    searchCurrentPositionBestEffort,
    clearSearch,
    getCurrentSession,
    getHits,
    resolveHitAbsPath,
  } = usePositionSearch();

  const { navigateToHit } = usePositionHitNavigation();

  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const session = getCurrentSession();
  const hits = getHits();

  const isSearching = state.isSearching;
  const isDone = !!session?.isDone && !isSearching;
  const error = session?.error ?? null;

  useEffect(() => {
    if (!isOpen) return;

    setActiveIndex(0);
    // 以前の検索結果を消す（セッション丸ごと）
    clearSearch();

    // currentSfen が無いなら何もしない（UI側で disable してる想定）
    if (!currentSfen) return;

    // 自動検索
    searchCurrentPositionBestEffort(5000).catch((e) => {
      console.error("[PositionSearchModal] auto search failed:", e);
    });
  }, [isOpen, currentSfen, clearSearch, searchCurrentPositionBestEffort]);

  // hits増減でactiveIndexがはみ出さないように
  useEffect(() => {
    if (!isOpen) return;
    if (activeIndex < hits.length) return;
    setActiveIndex(Math.max(0, hits.length - 1));
  }, [isOpen, activeIndex, hits.length]);

  const activeHit = hits[activeIndex];

  const accept = (hit: PositionHit) => {
    const absPath = resolveHitAbsPath(hit);
    if (!absPath) return;

    navigateToHit(absPath, hit.cursor);
    closeModal();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (isSearching) return;
      if (activeHit) accept(activeHit);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, hits.length - 1)));
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      onClose={closeModal}
      theme="dark"
      variant="dialog"
      size="lg"
      chrome="card"
      padding="md"
      scroll="content"
      closeOnEsc
      closeOnOverlay
      showCloseButton
    >
      <div className="pos-search" onKeyDown={onKeyDown} tabIndex={-1}>
        <header className="pos-search__header">
          <div className="pos-search__title">
            <Search size={16} />
            <span>局面検索</span>
          </div>

          <div className="pos-search__right">
            {isSearching && (
              <span className="pos-search__spinner" title="検索中">
                <Loader2 size={16} className="pos-search__spinIcon" />
              </span>
            )}
          </div>
        </header>

        <div className="pos-search__meta">
          <span>hits: {hits.length}</span>
          <span>
            {isSearching
              ? "searching"
              : error
                ? "error"
                : isDone
                  ? "done"
                  : "idle"}
          </span>
          {session?.stale && <span className="pos-search__stale">stale</span>}
          {error && <span className="pos-search__error">{error}</span>}
        </div>

        <div className="pos-search__query">
          <div className="pos-search__queryLabel">query</div>
          <div className="pos-search__queryValue">
            {currentSfen ?? "(no sfen)"}
          </div>
        </div>

        <div className="pos-search__list" ref={listRef}>
          {hits.length === 0 ? (
            <div className="pos-search__empty">
              {isSearching
                ? "検索結果を受信中…"
                : error
                  ? "検索に失敗しました"
                  : "結果がありません"}
            </div>
          ) : (
            hits.map((hit, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={`${hit.occ.file_id}-${hit.occ.gen}-${hit.occ.node_id}-${idx}`}
                  type="button"
                  className={`pos-search__item ${isActive ? "is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => accept(hit)}
                  disabled={isSearching}
                >
                  <div className="pos-search__itemMain">
                    {formatHitLabel(hit)}
                  </div>
                  <div className="pos-search__itemSub">
                    {resolveHitAbsPath(hit) ?? "path unknown"}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <footer className="pos-search__footer">
          <div className="pos-search__hint">
            <CornerDownLeft size={14} />
            <span>Enter: 移動 / j,k: 選択 / Esc: 閉じる</span>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
