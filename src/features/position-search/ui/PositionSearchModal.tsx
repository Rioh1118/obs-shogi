import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useURLParams } from "@/shared/lib/router/useURLParams";

import Modal from "../../../shared/ui/Modal";
import { usePositionHitNavigation } from "@/features/position-search/lib/usePositionHitNavigation";

import PositionSearchModalHeader from "./PositionSearchModalHeader";
import PositionSearchHitList from "./PositionSearchHitList";

import "./PositionSearchModal.scss";

import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";
import { buildPreviewData } from "@/entities/position/lib/buildPreviewData";
import PreviewPane from "../../../entities/position/ui/PositionPreviewPane";
import PositionSearchStatusBar from "./PositionSearchStatusBar";
import PositionSearchDestinationCard from "./PositionSearchDestinationCard";
import {
  hitKey,
  orderPositionHits,
} from "@/features/position-search/lib/orderPositionHits";
import { useGame } from "@/entities/game";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import { usePositionSearch, type PositionHit } from "@/entities/search";
import PositionSearchContinuation from "./PositionSearchContinuation";

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { currentSfen } = usePositionSync();
  const { state: gameState } = useGame();

  const {
    state,
    searchCurrentPositionBestEffort,
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

  const indexState = state.index.state;
  const indexStale =
    indexState === "Restoring" ||
    indexState === "Building" ||
    indexState === "Updating";

  const resultStale = indexStale || !!session?.stale;

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

  // -------------------------
  // 検索結果の“見せ方”補助
  // -------------------------
  const lastNonEmptyHitsRef = useRef<{
    sfen: string | null;
    hits: PositionHit[];
  }>({ sfen: null, hits: [] });

  useEffect(() => {
    if (!isOpen) return;
    if (!currentSfen) return;
    if (hits.length > 0) {
      lastNonEmptyHitsRef.current = { sfen: currentSfen, hits };
    }
  }, [isOpen, currentSfen, hits]);

  const displayHits = useMemo(() => {
    if (hits.length > 0) return hits;

    const prev = lastNonEmptyHitsRef.current;
    const canReuse = prev.sfen === currentSfen && (isSearching || resultStale);

    return canReuse ? prev.hits : hits;
  }, [hits, currentSfen, isSearching, resultStale]);

  const orderedHits = useMemo(() => {
    return orderPositionHits(
      displayHits,
      resolveHitAbsPath,
      gameState.loadedAbsPath ?? null,
    );
  }, [displayHits, resolveHitAbsPath, gameState.loadedAbsPath]);

  // -------------------------
  // 検索トリガ：モーダルを開いた瞬間だけ
  // -------------------------
  const prevOpenRef = useRef(false);

  const lastQueriedSfenRef = useRef<string | null>(null);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = isOpen;

    if (!isOpen) {
      lastQueriedSfenRef.current = null;
      return;
    }

    if (wasOpen) return;

    if (!currentSfen) return;

    if (lastQueriedSfenRef.current === currentSfen) return;

    lastQueriedSfenRef.current = currentSfen;

    searchCurrentPositionBestEffort(5000).catch((e) => {
      console.error("[PositionSearchModal] open-triggered search failed:", e);
    });
  }, [isOpen, currentSfen, searchCurrentPositionBestEffort]);

  const activeHit = orderedHits[activeIndex];
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    activeKeyRef.current = activeHit ? hitKey(activeHit) : null;
  }, [activeHit]);

  useEffect(() => {
    if (!isOpen) return;
    const n = orderedHits.length;
    if (activeIndex < n) return;
    setActiveIndex(Math.max(0, n - 1));
  }, [isOpen, activeIndex, orderedHits.length]);

  useEffect(() => {
    const k = activeKeyRef.current;
    if (!k) return;
    const next = orderedHits.findIndex((h) => hitKey(h) === k);
    if (next >= 0 && next !== activeIndex) setActiveIndex(next);
  }, [orderedHits, activeIndex]);

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
      setActiveIndex((i) =>
        Math.min(i + 1, Math.max(0, orderedHits.length - 1)),
      );
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = rootRef.current;
    if (!el) return;

    el.focus({ preventScroll: true });
  }, [isOpen]);

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
        <header className="pos-search__header">
          <PositionSearchModalHeader
            isSearching={isSearching}
            title="局面検索"
          />
        </header>

        <main className="pos-search__main" aria-label="検索とプレビュー">
          <div className="pos-search__grid">
            <section className="pos-search__left" aria-label="検索状態">
              <PositionSearchStatusBar
                hitsCount={displayHits.length}
                statusText={statusText}
                stale={resultStale}
                error={error}
              />

              <PositionSearchHitList
                hits={orderedHits}
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
              <div className="pos-search__preview">
                <PreviewPane previewData={previewData} toKan={toKan} />
              </div>

              <div className="pos-search__aux">
                <PositionSearchContinuation
                  activeHit={activeHit ?? null}
                  resolveAbsPath={resolveHitAbsPath}
                  ply={5}
                />

                <PositionSearchDestinationCard
                  currentAbsPath={gameState.loadedAbsPath ?? null}
                  destAbsPath={destAbsPath}
                />
              </div>
            </aside>
          </div>
        </main>
      </section>
    </Modal>
  );
}
