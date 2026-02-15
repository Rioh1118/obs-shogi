import { useEffect, useMemo, useRef, useState } from "react";

import { useURLParams } from "@/hooks/useURLParams";
import { usePosition } from "@/contexts/PositionContext";
import { usePositionSearch } from "@/contexts/PositionSearchContext";
import type { PositionHit } from "@/commands/search/types";

import Modal from "../Modal";
import { usePositionHitNavigation } from "@/hooks/usePositionHitNavigation";

import PositionSearchModalHeader from "./PositionSearchModalHeader";
import PositionSearchHitList from "./PositionSearchHitList";
import PositionSearchModalFooter from "./PositionSearchModalFooter";

import "./PositionSeachModal.scss";
import { useGame } from "@/contexts/GameContext";
import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";
import { buildPreviewData } from "@/utils/buildPreviewData";
import PreviewPane from "../NavigationModal/PreviewPane";
import PositionSearchStatusBar from "./PositionSearchStatusBar";
import PositionSearchDestinationCard from "./PositionSearchDestinationCard";

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { currentSfen } = usePosition();
  const { state: gameState } = useGame();

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

  const rootRef = useRef<HTMLElement | null>(null);

  const session = getCurrentSession();
  const hits = getHits();

  const isSearching = state.isSearching;
  const isDone = !!session?.isDone && !isSearching;
  const error = session?.error ?? null;

  const statusText = useMemo(() => {
    if (isSearching) return "検索中…";
    if (error) return "エラー";
    if (isDone) return "完了";
    return "待機中";
  }, [isSearching, error, isDone]);

  const toKan = useMemo(
    () => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k,
    [],
  );

  const previewData = useMemo(() => {
    const jkf = gameState.jkfPlayer;
    if (!isOpen || !jkf) return null;

    const nodeId = jkf.getTesuuPointer(jkf.tesuu);
    return buildPreviewData(jkf, nodeId);
  }, [isOpen, gameState.jkfPlayer]);

  useEffect(() => {
    if (!isOpen) return;

    setActiveIndex(0);
    clearSearch();

    if (!currentSfen) return;

    // キー操作を確実に受ける（tabIndex=-1 の要素を focus）
    queueMicrotask(() => rootRef.current?.focus());

    searchCurrentPositionBestEffort(5000).catch((e) => {
      console.error("[PositionSearchModal] auto search failed:", e);
    });
  }, [isOpen, currentSfen, clearSearch, searchCurrentPositionBestEffort]);

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
    // ※ Modal側でもEscを見てるが、ここで扱うのはOK（挙動を統一しやすい）
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

  const destAbsPath = activeHit ? resolveHitAbsPath(activeHit) : null;

  return (
    <Modal
      onClose={closeModal}
      theme="dark"
      variant="workspace"
      size="xl"
      chrome="card"
      padding="none"
      scroll="none"
      closeOnEsc
      closeOnOverlay
      showCloseButton={false}
    >
      <section
        ref={(el) => {
          rootRef.current = el;
        }}
        className="pos-search"
        onKeyDown={onKeyDown}
        tabIndex={-1}
        aria-label="局面検索"
      >
        <PositionSearchModalHeader isSearching={isSearching} title="局面検索" />

        <main className="pos-search__main">
          <div className="pos-search__grid">
            <section className="pos-search__left" aria-label="検索状態">
              <PositionSearchStatusBar
                hitsCount={hits.length}
                statusText={statusText}
                stale={!!session?.stale}
                error={error}
              />

              <PositionSearchHitList
                hits={hits}
                activeIndex={activeIndex}
                onActiveIndexChange={setActiveIndex}
                onAccept={accept}
                isSearching={isSearching}
                error={error}
                resolveAbsPath={resolveHitAbsPath}
              />
            </section>
            <aside className="pos-search__right" aria-label="局面プレビュー">
              <div className="pos-search__paneTitle">現在の局面</div>

              <PreviewPane previewData={previewData} toKan={toKan} />

              <PositionSearchDestinationCard
                currentAbsPath={gameState.loadedAbsPath ?? null}
                destAbsPath={destAbsPath}
                tesuu={activeHit?.cursor.tesuu ?? null}
                forks={activeHit?.cursor.fork_pointers.length ?? null}
              />
            </aside>
          </div>
        </main>

        <PositionSearchModalFooter />
      </section>
    </Modal>
  );
}
